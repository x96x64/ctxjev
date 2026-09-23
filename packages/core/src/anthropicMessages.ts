import { excerpt, toolEntryContent, toolExcerpt, toolResultText } from './entryText.js'
import { MAX_CONCURRENT_CHUNK_REQUESTS, mapWithConcurrencyLimit, pruneContext, type ScoreEntriesOptions } from './prune.js'
import { redactSecrets } from './redact.js'
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

/** `text`/`at`: the entry's replaceable text and where it lives — a tool call's result, not its tool_use. */
type MappedEntry = Entry & { locations: Location[]; text?: string; at?: Location }

/**
 * One entry per text block (or string message), and one per tool call — its `tool_use` and
 * matching `tool_result` together, the same shape parseClaudeCodeTranscript produces. Images,
 * documents, and thinking blocks aren't scored. Timestamps are message positions, since the
 * Messages API has none: recency only needs order.
 */
export function messagesToEntries(messages: AnthropicMessage[]): Entry[] {
  return mapMessages(messages).map(toEntry)
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
      const text = message.content
      entries.push({ id: `msg:${m}`, role, content: excerpt(text), timestamp: m, sourceTokens: estimateTokens(text), locations: [{ message: m }], text, at: { message: m } })
      return
    }
    message.content.forEach((block, b) => {
      if (block.type === 'text') {
        const text = (block as { text: string }).text
        const at = { message: m, block: b }
        entries.push({ id: `msg:${m}:${b}`, role, content: excerpt(text), timestamp: m, sourceTokens: estimateTokens(text), locations: [at], text, at })
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
          text: result?.text,
          at: result?.location,
        })
      }
    })
  })

  return entries
}

/**
 * How to shorten an entry marked `summarize`. `'excerpt'` keeps the head and tail of its text (where
 * a command's summary line or final error usually is). A function gets the entry and its full text,
 * with secrets already masked, and returns the replacement; it's called for up to 5 entries at once.
 */
export type Summarizer = 'excerpt' | ((entry: Entry, text: string) => Promise<string>)

export type PruneMessagesOptions = ScoreEntriesOptions & {
  policy?: PruningPolicy
  /** Messages at the end that are never touched — the current turn, and any tool call still waiting on a result. Default 2. */
  protectLast?: number
  /**
   * Once what scored below `policy.dropBelow` is gone, keep removing the lowest-scoring unprotected
   * entries until the scored content (text and tool calls; not images or thinking) fits in this
   * many tokens. `overBudget` says if even the protected entries alone don't fit.
   */
  targetTokens?: number
  /**
   * Shorten entries marked `summarize` instead of leaving them as they are. A tool call keeps its
   * `tool_use`; only its result is replaced (as plain text, so any images in it go too). A
   * replacement that wouldn't be shorter is skipped.
   */
  summarize?: Summarizer
  /**
   * Leave the conversation untouched unless this saves at least this many tokens. Any change
   * invalidates a prompt cache from the first changed message on (see `cache` in the result), so a
   * small saving can cost more than it saves. Default 0.
   */
  minSavedTokens?: number
  /**
   * Never remove what the user wrote (their text, not tool results). It costs few tokens, and it's
   * where constraints and changes of plan live: an agent that lost "keep the mark for 24 hours"
   * picked its own value rather than asking or re-checking. Default true.
   */
  keepUserText?: boolean
  /**
   * Add a one-line note where history was removed, so the model knows its view of the conversation
   * is incomplete and re-reads files instead of trusting what it half-remembers. It goes at the end
   * of the first unprotected user message after the first change; with none, no note is added.
   * Default true.
   */
  marker?: boolean
}

export type PruneMessagesResult = {
  messages: AnthropicMessage[]
  /** The policy's verdict per entry. An entry removed only to meet `targetTokens` still shows its own action here. */
  decisions: PruneDecision[]
  /** Ids of the entries actually removed: `drop`s outside the protected messages, plus any removed to meet `targetTokens`. */
  removed: string[]
  /** Ids of the entries shortened by `summarize`. */
  summarized: string[]
  /** Estimated tokens removed from the conversation. */
  savedTokens: number
  /**
   * The effect on a prompt cache: every message from `firstChangedMessage` (an index into the
   * original `messages`) on is new to the cache, `invalidatedTokens` of it, and gets written again
   * on the next request. `null` when nothing changed.
   */
  cache: { firstChangedMessage: number | null; invalidatedTokens: number }
  /** `targetTokens` was set and the result still doesn't fit — only protected entries are left over it. */
  overBudget: boolean
  /** Set when `minSavedTokens` held the changes back: what they would have saved. */
  heldBack?: number
}

type Replacement = { text: string; saved: number }

/**
 * Scores an Anthropic Messages conversation and removes what came back `drop`, keeping it a valid
 * request: a tool call's `tool_use` and `tool_result` are always removed together, a message left
 * empty is removed, and the first message (the original task) and the last `protectLast` messages
 * are never touched. By default `summarize` is only reported; pass `summarize` to shorten those
 * entries, `targetTokens` to fit a budget, and `minSavedTokens` to skip changes too small to be worth
 * a prompt-cache rewrite. Consecutive same-role messages can result; the Messages API accepts those.
 */
export async function pruneMessages(messages: AnthropicMessage[], goal: string, options: PruneMessagesOptions = {}): Promise<PruneMessagesResult> {
  const { policy = DEFAULT_POLICY, protectLast = 2, targetTokens, summarize, minSavedTokens = 0, keepUserText = true, marker = true, ...scoreOptions } = options
  const mapped = mapMessages(messages)
  const decisions = await pruneContext(mapped.map(toEntry), goal, policy, scoreOptions)
  const decisionById = new Map(decisions.map((d) => [d.entryId, d]))
  const entryById = new Map(mapped.map((e) => [e.id, e]))

  const lastProtected = messages.length - Math.max(1, protectLast)
  const inProtectedMessage = (entry: MappedEntry) => entry.locations.some((l) => l.message === 0 || l.message >= lastProtected)
  const isProtected = (entry: MappedEntry) => inProtectedMessage(entry) || (keepUserText && entry.role === 'user')
  const prunable = mapped.filter((entry) => !isProtected(entry))
  const tokensOf = (entry: MappedEntry) => entry.sourceTokens ?? 0

  const removed = new Set(prunable.filter((e) => decisionById.get(e.id)!.action === 'drop').map((e) => e.id))

  const replacements = new Map<string, Replacement>()
  if (summarize) {
    const candidates = prunable.filter((e) => !removed.has(e.id) && decisionById.get(e.id)!.action === 'summarize' && e.text !== undefined)
    await mapWithConcurrencyLimit(candidates, MAX_CONCURRENT_CHUNK_REQUESTS, async (entry) => {
      const original = entry.text!
      const originalTokens = estimateTokens(original)
      const text = summarize === 'excerpt' ? `[shortened by ctxjev from ~${originalTokens} tokens] ${toolExcerpt(original)}` : await summarize(toEntry(entry), redactSecrets(original))
      const saved = originalTokens - estimateTokens(text)
      if (saved > 0) replacements.set(entry.id, { text, saved })
    })
  }

  const sizeOf = (entry: MappedEntry) => tokensOf(entry) - (replacements.get(entry.id)?.saved ?? 0)
  const untouchedTotal = mapped.reduce((sum, e) => sum + tokensOf(e), 0)
  let remaining = mapped.filter((e) => !removed.has(e.id)).reduce((sum, e) => sum + sizeOf(e), 0)
  if (targetTokens !== undefined && remaining > targetTokens) {
    const byScore = prunable.filter((e) => !removed.has(e.id)).sort((a, b) => decisionById.get(a.id)!.combinedScore - decisionById.get(b.id)!.combinedScore)
    for (const entry of byScore) {
      if (remaining <= targetTokens) break
      remaining -= sizeOf(entry)
      removed.add(entry.id)
      replacements.delete(entry.id)
    }
  }

  const removedEntries = mapped.filter((e) => removed.has(e.id))
  const savedTokens = removedEntries.reduce((sum, e) => sum + tokensOf(e), 0) + [...replacements.values()].reduce((sum, r) => sum + r.saved, 0)
  if (savedTokens === 0 || savedTokens < minSavedTokens) {
    return {
      messages,
      decisions,
      removed: [],
      summarized: [],
      savedTokens: 0,
      cache: { firstChangedMessage: null, invalidatedTokens: 0 },
      overBudget: targetTokens !== undefined && untouchedTotal > targetTokens,
      ...(savedTokens > 0 && { heldBack: savedTokens }),
    }
  }

  const removedBlocks = new Set<string>()
  const removedMessages = new Set<number>()
  for (const entry of removedEntries) {
    for (const l of entry.locations) {
      if (l.block === undefined) removedMessages.add(l.message)
      else removedBlocks.add(`${l.message}:${l.block}`)
    }
  }
  const replaceAt = new Map<string, string>()
  for (const [id, { text }] of replacements) {
    const at = entryById.get(id)!.at!
    replaceAt.set(at.block === undefined ? `${at.message}` : `${at.message}:${at.block}`, text)
  }

  const pruned: AnthropicMessage[] = []
  const originalIndex: number[] = []
  messages.forEach((message, m) => {
    if (removedMessages.has(m)) return
    originalIndex[pruned.length] = m
    if (typeof message.content === 'string') {
      const text = replaceAt.get(`${m}`)
      pruned.push(text === undefined ? message : { ...message, content: text })
      return
    }
    let changed = false
    const content: AnthropicContentBlock[] = []
    message.content.forEach((block, b) => {
      if (removedBlocks.has(`${m}:${b}`)) {
        changed = true
        return
      }
      const text = replaceAt.get(`${m}:${b}`)
      if (text === undefined) content.push(block)
      else {
        changed = true
        content.push(block.type === 'tool_result' ? { ...block, content: text } : { ...block, text })
      }
    })
    if (!changed) pruned.push(message)
    // Thinking from an earlier turn isn't used by the API, so a message left holding only that is removed too.
    else if (content.some((block) => block.type !== 'thinking' && block.type !== 'redacted_thinking')) pruned.push({ ...message, content })
    else originalIndex.pop()
  })

  const changedAt = [...removedEntries.flatMap((e) => e.locations), ...[...replacements.keys()].map((id) => entryById.get(id)!.at!)].map((l) => l.message)
  const firstChangedMessage = Math.min(...changedAt)
  let markerTokens = 0
  if (marker && removedEntries.length > 0) {
    const k = pruned.findIndex((m, i) => m.role === 'user' && originalIndex[i] >= firstChangedMessage && originalIndex[i] > 0 && originalIndex[i] < lastProtected)
    if (k >= 0) {
      const removedTokens = removedEntries.reduce((sum, e) => sum + tokensOf(e), 0)
      const note = `[ctxjev: ${removedEntries.length} earlier entries (~${removedTokens.toLocaleString('en-US')} tokens) were removed from this conversation to save space. Re-read files or re-run commands rather than relying on what they said.]`
      const target = pruned[k]
      const blocks = typeof target.content === 'string' ? [{ type: 'text' as const, text: target.content }] : target.content
      pruned[k] = { ...target, content: [...blocks, { type: 'text', text: note }] }
      markerTokens = estimateTokens(note)
    }
  }
  const invalidatedTokens =
    mapped.filter((e) => !removed.has(e.id) && e.locations.some((l) => l.message >= firstChangedMessage)).reduce((sum, e) => sum + sizeOf(e), 0) + markerTokens

  return {
    messages: pruned,
    decisions,
    removed: removedEntries.map((e) => e.id),
    summarized: [...replacements.keys()],
    savedTokens: savedTokens - markerTokens,
    cache: { firstChangedMessage, invalidatedTokens },
    overBudget: targetTokens !== undefined && remaining > targetTokens,
  }
}

function toEntry({ locations: _locations, text: _text, at: _at, ...entry }: MappedEntry): Entry {
  return entry
}
