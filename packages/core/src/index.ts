import { chunkEntries } from './chunk.js'
import { scoreRelevance } from './jevClient.js'
import { combineScore, decideAction } from './policy.js'
import { computeRecency } from './recency.js'
import { DEFAULT_POLICY, type Entry, type PruneDecision, type PruningPolicy, type ScoredEntry } from './types.js'

export * from './types.js'
export { summarizeSavings, type SavingsReport } from './savings.js'
export { estimateTokens } from './tokenEstimate.js'

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
): Promise<ScoredEntry[]> {
  const chunks = chunkEntries(entries)
  const verdicts = (await Promise.all(chunks.map((chunk) => scoreRelevance(goal, chunk)))).flat()

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
): Promise<PruneDecision[]> {
  const scored = await scoreEntries(entries, goal, policy.recencyWeight)
  return scored.map((entry) => ({ ...entry, action: decideAction(entry.combinedScore, policy) }))
}
