import { type ScoreCache } from './cache.js'
import { chunkEntries } from './chunk.js'
import { scoreRelevance } from './jevClient.js'
import { combineScore, decideAction } from './policy.js'
import { computeRecency } from './recency.js'
import { DEFAULT_POLICY, type Entry, type JevUsage, type PruneDecision, type PruningPolicy, type ScoredEntry } from './types.js'

export * from './types.js'
export { atomicWriteFile } from './atomicWrite.js'
export { summarizeSavings, type SavingsReport } from './savings.js'
export { estimateTokens } from './tokenEstimate.js'
export { parseClaudeCodeTranscript, inferGoalFromEntries, truncate } from './claudeCodeTranscript.js'
export { createUsageAccumulator } from './usage.js'
export { cacheKeyFor, type ScoreCache } from './cache.js'
export { isValidPolicyOrdering } from './policy.js'

export type ScoreEntriesOptions = {
  /** Called once per underlying Jev request (one per chunk) with that request's token usage. */
  onUsage?: (usage: JevUsage) => void
  /** Checked before, and populated after, each Jev request — see `ScoreCache`. */
  cache?: ScoreCache
}

// A large transcript can chunk into hundreds of requests; firing all of them at once relies
// entirely on the SDK's own retry/backoff to survive the resulting rate-limit thundering herd.
const MAX_CONCURRENT_CHUNK_REQUESTS = 5

async function mapWithConcurrencyLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    for (let i = nextIndex++; i < items.length; i = nextIndex++) {
      results[i] = await fn(items[i])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Score every entry's relevance to `goal` via Jev, blended with its recency within this batch
 * (see `recency.ts`) per `recencyWeight` — but stop short of deciding what to actually do about
 * it. `pruneContext` (below) is `scoreEntries` plus that decision; call this directly when you
 * want the scores themselves (e.g. the MCP server's `score_relevance` tool, or to compare
 * policies against the same scores without re-querying Jev).
 */
export async function scoreEntries(
  entries: Entry[],
  goal: string,
  recencyWeight: number = DEFAULT_POLICY.recencyWeight,
  options: ScoreEntriesOptions = {},
): Promise<ScoredEntry[]> {
  const seenIds = new Set<string>()
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new Error(`duplicate entry id "${entry.id}" — every entry must have a unique id`)
    }
    seenIds.add(entry.id)
  }

  const chunks = chunkEntries(entries)
  const chunkResults = await mapWithConcurrencyLimit(chunks, MAX_CONCURRENT_CHUNK_REQUESTS, async (chunk) => {
    const { verdicts, usage } = await scoreRelevance(goal, chunk, options.cache)
    options.onUsage?.(usage)
    return verdicts
  })
  const verdicts = chunkResults.flat()

  const verdictByEntryId = new Map(verdicts.map((v) => [v.entryId, v]))
  const recencyByEntryId = computeRecency(entries)

  return entries.map((entry) => {
    const verdict = verdictByEntryId.get(entry.id)
    if (!verdict) {
      throw new Error(`no Jev verdict returned for entry ${entry.id}`)
    }
    const recency = recencyByEntryId.get(entry.id)!
    return {
      entryId: entry.id,
      relevance: verdict.relevance,
      recency,
      combinedScore: combineScore(verdict.relevance, recency, recencyWeight),
    }
  })
}

/**
 * `scoreEntries` plus applying `policy`'s thresholds to each combined score, deciding what to
 * keep, drop, or summarize. Entries are chunked into batches for the underlying fan-out
 * requests; order of the returned decisions matches the input order.
 */
export async function pruneContext(
  entries: Entry[],
  goal: string,
  policy: PruningPolicy = DEFAULT_POLICY,
  options: ScoreEntriesOptions = {},
): Promise<PruneDecision[]> {
  const scored = await scoreEntries(entries, goal, policy.recencyWeight, options)
  return scored.map((entry) => ({ ...entry, action: decideAction(entry.combinedScore, policy) }))
}
