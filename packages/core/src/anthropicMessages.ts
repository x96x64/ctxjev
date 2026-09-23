import { excerpt, toolEntryContent, toolResultText } from './entryText.js'
import { pruneContext, type ScoreEntriesOptions } from './prune.js'
import { estimateTokens } from './tokenEstimate.js'
import { DEFAULT_POLICY, type Entry, type PruneDecision, type PruningPolicy } from './types.js'

/**
 * The Anthropic Messages API's conversation shape, loosely typed: only the blocks ctxjev reads are
 * spelled out, and every other field passes through untouched.
 */
export type AnthropicContentBlock =
  | { type: 'text'; text: string; [key: string]: unknown }
  | { type: 'tool_use'; id: string; name: string; input: unknown; [key: string]: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean; [key: string]: unknown }
  | { type: string; [key: string]: unknown }

export type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicContentBlock[]; [key: string]: unknown }

type Location = { message: number; block?: number }

type MappedEntry = Entry & { locations: Location[] }

/**
 * One entry per text block (or string message), and one per tool call — its `tool_use` and
 * matching `tool_result` together, the same shape parseClaudeCodeTranscript produces. Images,
 * documents, and thinking blocks aren't scored. Timestamps are message positions, since the
 * Messages API has none: recency only needs order.
 */
export function messagesToEntries(messages: AnthropicMessage[]): Entry[] {
  return mapMessages(messages).map(({ locations: _locations, ...entry }) => entry)
}

function mapMessages(messages: AnthropicMessage[]): MappedEntry[] {
  const entries: MappedEntry[] = []
  const results = new Map<string, { location: Location; text: string; isError?: boolean }>()

  messages.forEach((message, m) => {
    if (!Array.isArray(message.content)) return
    message.content.forEach((block, b) => {
      if (block.type === 'tool_result') {
        const result = block as Extract<AnthropicContentBlock, { type: 'tool_result' }>
        results.set(result.tool_use_id, { location: { message: m, block: b }, text: toolResultText(result.content), isError: result.is_error })
      }
    })
  })

  messages.forEach((message, m) => {
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    if (typeof message.content === 'string') {
      entries.push({ id: `msg:${m}`, role, content: excerpt(message.content), timestamp: m, sourceTokens: estimateTokens(message.content), locations: [{ message: m }] })
      return
    }
    message.content.forEach((block, b) => {
      if (block.type === 'text') {
        const text = (block as { text: string }).text
        entries.push({ id: `msg:${m}:${b}`, role, content: excerpt(text), timestamp: m, sourceTokens: estimateTokens(text), locations: [{ message: m, block: b }] })
      } else if (block.type === 'tool_use') {
        const use = block as Extract<AnthropicContentBlock, { type: 'tool_use' }>
        const result = results.get(use.id)
        entries.push({
          id: `tool:${use.id}`,
          role: 'tool',
          toolName: use.name,
          content: toolEntryContent(use.name, use.input, result),
          timestamp: m,
          sourceTokens: estimateTokens(JSON.stringify(use.input ?? {})) + (result ? estimateTokens(result.text) : 0),
          locations: result ? [{ message: m, block: b }, result.location] : [{ message: m, block: b }],
        })
      }
    })
  })

  return entries
}

export type PruneMessagesOptions = ScoreEntriesOptions & {
  policy?: PruningPolicy
  /** Messages at the end that are never touched — the current turn, and any tool call still waiting on a result. Default 2. */
  protectLast?: number
}

export type PruneMessagesResult = {
  messages: AnthropicMessage[]
  decisions: PruneDecision[]
  /** Ids of the entries actually removed (only `drop`s outside the protected messages). */
  removed: string[]
}

/**
 * Scores an Anthropic Messages conversation and removes what came back `drop`, keeping it a valid
 * request: a tool call's `tool_use` and `tool_result` are always removed together, a message left
 * empty is removed, and the first message (the original task) and the last `protectLast` messages
 * are never touched. `summarize` is reported in `decisions` but left in place — ctxjev can't
 * summarize, so what to do with those is up to you. Consecutive same-role messages can result;
 * the Messages API accepts those.
 */
export async function pruneMessages(messages: AnthropicMessage[], goal: string, options: PruneMessagesOptions = {}): Promise<PruneMessagesResult> {
  const { policy = DEFAULT_POLICY, protectLast = 2, ...scoreOptions } = options
  const mapped = mapMessages(messages)
  const decisions = await pruneContext(mapped.map(({ locations: _locations, ...entry }) => entry), goal, policy, scoreOptions)

  const lastProtected = messages.length - Math.max(1, protectLast)
  const isProtected = (entry: MappedEntry) => entry.locations.some((l) => l.message === 0 || l.message >= lastProtected)
  const dropIds = new Set(decisions.filter((d) => d.action === 'drop').map((d) => d.entryId))
  const toRemove = mapped.filter((entry) => dropIds.has(entry.id) && !isProtected(entry))

  const removedBlocks = new Set<string>()
  const removedMessages = new Set<number>()
  for (const entry of toRemove) {
    for (const l of entry.locations) {
      if (l.block === undefined) removedMessages.add(l.message)
      else removedBlocks.add(`${l.message}:${l.block}`)
    }
  }

  const pruned: AnthropicMessage[] = []
  messages.forEach((message, m) => {
    if (removedMessages.has(m)) return
    if (typeof message.content === 'string') {
      pruned.push(message)
      return
    }
    const content = message.content.filter((_, b) => !removedBlocks.has(`${m}:${b}`))
    if (content.length === message.content.length) {
      pruned.push(message)
      return
    }
    // Thinking from an earlier turn isn't used by the API, so a message left holding only that is removed too.
    if (content.some((block) => block.type !== 'thinking' && block.type !== 'redacted_thinking')) pruned.push({ ...message, content })
  })

  return { messages: pruned, decisions, removed: toRemove.map((e) => e.id) }
}
