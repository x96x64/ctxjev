import { estimateTokens } from './tokenEstimate.js'
import type { Entry, PruneDecision } from './types.js'
import { shown, validateDecisions, validateEntries, validateOptions, validateUniqueIds } from './validate.js'

export type PruneEntriesOptions = {
  /**
   * Never remove the first entry whose role is `user`: usually the original request, which the
   * default `'recency'` scorer ranks lowest of all simply because it's oldest. Default true.
   */
  protectFirstUserEntry?: boolean
  /** Entries at the end of the list that are never removed: the work as it stands. Default 2. */
  protectLast?: number
}

/** The entries marked `drop` that `pruneEntries()` kept, by reason. An entry protected for both is listed under the first. */
export type EntryKeptDrops = {
  firstUserEntry: string[]
  lastEntries: string[]
}

export type PruneEntriesResult = {
  /** What's left, in the original order. */
  entries: Entry[]
  /** Ids of the entries removed: every `drop` that isn't protected. */
  removed: string[]
  keptDrops: EntryKeptDrops
  /** Tokens in the removed entries (`sourceTokens`, or the content's own count without it). */
  savedTokens: number
  /** Set when the first user entry was removed (only possible with `protectFirstUserEntry: false`): its id. */
  firstUserEntryRemoved?: string
  /**
   * Set when there's no user entry to protect and the first entry was removed anyway: its id. Only
   * with `protectFirstUserEntry` on, so a caller can say that nothing stood in for the request.
   */
  firstEntryRemovedWithoutUserEntry?: string
}

/**
 * Applies `pruneContext()`'s decisions to a plain entry list (ctxjev's own transcript format):
 * removes the entries marked `drop`, except the first user entry and the last `protectLast`, the
 * same protection `pruneMessages()` gives an Anthropic Messages conversation's first message and
 * tail. `decisions` must correspond to `entries` one to one.
 */
export function pruneEntries(entries: Entry[], decisions: PruneDecision[], options: PruneEntriesOptions = {}): PruneEntriesResult {
  validateEntries(entries)
  validateUniqueIds(entries)
  validateDecisions(decisions)
  validateOptions(options)
  const { protectFirstUserEntry = true, protectLast = 2 } = options
  if (typeof protectFirstUserEntry !== 'boolean') throw new Error(`protectFirstUserEntry must be true or false, got ${shown(protectFirstUserEntry)}`)
  if (typeof protectLast !== 'number' || !Number.isFinite(protectLast) || protectLast < 0) throw new Error(`protectLast must be a number of at least 0, got ${shown(protectLast)}`)
  const decisionById = new Map(decisions.map((d) => [d.entryId, d]))
  const firstUser = entries.find((e) => e.role === 'user')
  const tailStart = entries.length - Math.max(0, Math.floor(protectLast))

  const keptDrops: EntryKeptDrops = { firstUserEntry: [], lastEntries: [] }
  const removed = new Set<string>()
  entries.forEach((entry, i) => {
    const decision = decisionById.get(entry.id)
    if (!decision) throw new Error(`no decision found for entry "${entry.id}" — entries and decisions must correspond 1:1`)
    if (decision.action !== 'drop') return
    if (protectFirstUserEntry && entry === firstUser) keptDrops.firstUserEntry.push(entry.id)
    else if (i >= tailStart) keptDrops.lastEntries.push(entry.id)
    else removed.add(entry.id)
  })

  const kept = entries.filter((e) => !removed.has(e.id))
  const savedTokens = entries.filter((e) => removed.has(e.id)).reduce((sum, e) => sum + (e.sourceTokens ?? estimateTokens(e.content)), 0)
  return {
    entries: kept,
    removed: entries.filter((e) => removed.has(e.id)).map((e) => e.id),
    keptDrops,
    savedTokens,
    ...(firstUser && removed.has(firstUser.id) && { firstUserEntryRemoved: firstUser.id }),
    // A transcript with no user entry (tool output only) has no request to protect; its first entry
    // is often a tool result, not a request, so it isn't protected in its place, only named.
    ...(protectFirstUserEntry && !firstUser && entries.length > 0 && removed.has(entries[0].id) && { firstEntryRemovedWithoutUserEntry: entries[0].id }),
  }
}
