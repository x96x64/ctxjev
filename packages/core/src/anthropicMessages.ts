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
  /**
   * Never touch the latest turn: the last user message that has text of its own (an instruction,
   * not only tool results) and everything after it, however many tool round-trips that is. Default
   * true. In an agent loop whose only user text is the first message, that is the whole
   * conversation, so nothing is pruned: pass `false` there, and `protectLast` alone guards the tail.
   */
  protectLastTurn?: boolean
  /** Messages at the end that are never touched, whatever `protectLastTurn` says — a floor for any tool call still waiting on a result. Default 2. */
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
   * Leave the conversation untouched unless this saves at least this many tokens, after the removal
   * note's own tokens (see `marker`). Any change invalidates a prompt cache from the first changed
   * message on (see `cache` in the result), so a small saving can cost more than it saves. Default 0.
   * Independently of this, a change that wouldn't save anything once the note is added is never made.
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

/**
 * The entries the policy marked `drop` that `pruneMessages()` didn't remove, by reason (entry ids).
 * The first four are protection: those entries are never removed while the option stands. The last
 * two apply to the change as a whole: nothing was removed, so every unprotected drop is listed there.
 * An entry protected for more than one reason is listed under the first that applies, in this order.
 */
export type KeptDrops = {
  /** In the first message, the original task, which is never touched. */
  firstMessage: string[]
  /** In the latest turn (`protectLastTurn`). */
  latestTurn: string[]
  /** In the last `protectLast` messages. */
  lastMessages: string[]
  /** The user's own text (`keepUserText`). */
  userText: string[]
  /** Not protected, but removing the drops wouldn't save any tokens once the removal note (`marker`) is counted, so nothing was removed. */
  noNetSaving: string[]
  /** Not protected, but the change would have saved fewer than `minSavedTokens` (see `heldBack`), so nothing was removed. */
  belowMinSaved: string[]
}

export type PruneMessagesResult = {
  messages: AnthropicMessage[]
  /** The policy's verdict per entry. An entry removed only to meet `targetTokens` still shows its own action here. */
  decisions: PruneDecision[]
  /** Ids of the entries actually removed: `drop`s outside the protected messages, plus any removed to meet `targetTokens`. */
  removed: string[]
  /** Ids of the entries shortened by `summarize`. */
  summarized: string[]
  /** Estimated tokens removed from the conversation, net of the removal note. Never negative. */
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
  /** Why each entry marked `drop` but not in `removed` stayed. Every `drop` is in exactly one of `removed` and these lists. */
  keptDrops: KeptDrops
}

type Replacement = { text: string; saved: number }

/** The index of the last user message with text of its own, or -1: where the latest turn starts. */
export function lastTurnStart(messages: AnthropicMessage[]): number {
  for (let m = messages.length - 1; m >= 0; m--) {
    const { role, content } = messages[m]
    if (role !== 'user') continue
    if (typeof content === 'string' ? content.trim() !== '' : content.some((b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '')) return m
  }
  return -1
}

/**
 * Scores an Anthropic Messages conversation and removes what came back `drop`, keeping it a valid
 * request: a tool call's `tool_use` and `tool_result` are always removed together, a message left
 * empty is removed, and the first message (the original task), the latest turn (`protectLastTurn`),
 * and the last `protectLast` messages are never touched. By default `summarize` is only reported; pass `summarize` to shorten those
 * entries, `targetTokens` to fit a budget, and `minSavedTokens` to skip changes too small to be worth
 * a prompt-cache rewrite. Consecutive same-role messages can result; the Messages API accepts those.
 */
export async function pruneMessages(messages: AnthropicMessage[], goal: string, options: PruneMessagesOptions = {}): Promise<PruneMessagesResult> {
  const { policy = DEFAULT_POLICY, protectLastTurn = true, protectLast = 2, targetTokens, summarize, minSavedTokens = 0, keepUserText = true, marker = true, ...scoreOptions } = options
  const mapped = mapMessages(messages)
  const decisions = await pruneContext(mapped.map(toEntry), goal, policy, scoreOptions)
  const decisionById = new Map(decisions.map((d) => [d.entryId, d]))
  const entryById = new Map(mapped.map((e) => [e.id, e]))

  // Every message from here on is protected: the latest turn, or at least the last protectLast.
  const turnStart = protectLastTurn ? lastTurnStart(messages) : -1
  const lastProtected = Math.min(messages.length - Math.max(1, protectLast), turnStart === -1 ? Infinity : turnStart)
  const protection = (entry: MappedEntry): keyof KeptDrops | undefined => {
    if (entry.locations.some((l) => l.message === 0)) return 'firstMessage'
    if (turnStart !== -1 && entry.locations.some((l) => l.message >= turnStart)) return 'latestTurn'
    if (entry.locations.some((l) => l.message >= lastProtected)) return 'lastMessages'
    if (keepUserText && entry.role === 'user') return 'userText'
    return undefined
  }
  const prunable = mapped.filter((entry) => protection(entry) === undefined)
  const isDrop = (entry: MappedEntry) => decisionById.get(entry.id)!.action === 'drop'
  const keptDrops = (unremoved: 'noNetSaving' | 'belowMinSaved' | undefined): KeptDrops => {
    const kept: KeptDrops = { firstMessage: [], latestTurn: [], lastMessages: [], userText: [], noNetSaving: [], belowMinSaved: [] }
    for (const entry of mapped) {
      if (!isDrop(entry)) continue
      const reason = protection(entry) ?? unremoved
      if (reason) kept[reason].push(entry.id)
    }
    return kept
  }
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
  const grossSaved = removedEntries.reduce((sum, e) => sum + tokensOf(e), 0) + [...replacements.values()].reduce((sum, r) => sum + r.saved, 0)
  const unchanged = (heldBack?: number): PruneMessagesResult => ({
    messages,
    decisions,
    removed: [],
    summarized: [],
    savedTokens: 0,
    cache: { firstChangedMessage: null, invalidatedTokens: 0 },
    overBudget: targetTokens !== undefined && untouchedTotal > targetTokens,
    ...(heldBack !== undefined && { heldBack }),
    keptDrops: keptDrops(heldBack !== undefined ? 'belowMinSaved' : 'noNetSaving'),
  })
  if (grossSaved === 0) return unchanged()

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

  // A loop, not Math.min(...): spreading every removed entry's locations as arguments overflows the
  // stack on a large enough conversation (150,000 tool calls did).
  let firstChangedMessage = Infinity
  for (const entry of removedEntries) for (const l of entry.locations) if (l.message < firstChangedMessage) firstChangedMessage = l.message
  for (const id of replacements.keys()) firstChangedMessage = Math.min(firstChangedMessage, entryById.get(id)!.at!.message)

  // The note costs tokens too, so it counts against what the change saves: a change whose note
  // outweighs it would make the conversation larger, and is skipped like one under minSavedTokens.
  let note: { index: number; text: string; tokens: number } | undefined
  if (marker && removedEntries.length > 0) {
    const k = pruned.findIndex((m, i) => m.role === 'user' && originalIndex[i] >= firstChangedMessage && originalIndex[i] > 0 && originalIndex[i] < lastProtected)
    if (k >= 0) {
      const removedTokens = removedEntries.reduce((sum, e) => sum + tokensOf(e), 0)
      const text = `[ctxjev: ${removedEntries.length} earlier entries (~${removedTokens.toLocaleString('en-US')} tokens) were removed from this conversation to save space. Re-read files or re-run commands rather than relying on what they said.]`
      note = { index: k, text, tokens: estimateTokens(text) }
    }
  }
  const savedTokens = grossSaved - (note?.tokens ?? 0)
  if (savedTokens <= 0) return unchanged()
  if (savedTokens < minSavedTokens) return unchanged(savedTokens)

  if (note) {
    const target = pruned[note.index]
    const blocks = typeof target.content === 'string' ? [{ type: 'text' as const, text: target.content }] : target.content
    pruned[note.index] = { ...target, content: [...blocks, { type: 'text', text: note.text }] }
  }
  const invalidatedTokens =
    mapped.filter((e) => !removed.has(e.id) && e.locations.some((l) => l.message >= firstChangedMessage)).reduce((sum, e) => sum + sizeOf(e), 0) + (note?.tokens ?? 0)

  return {
    messages: pruned,
    decisions,
    removed: removedEntries.map((e) => e.id),
    summarized: [...replacements.keys()],
    savedTokens,
    cache: { firstChangedMessage, invalidatedTokens },
    overBudget: targetTokens !== undefined && remaining > targetTokens,
    // Every unprotected drop was removed, so only protected ones are left to explain.
    keptDrops: keptDrops(undefined),
  }
}

function toEntry({ locations: _locations, text: _text, at: _at, ...entry }: MappedEntry): Entry {
  return entry
}
