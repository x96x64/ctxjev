import { chunkEntries } from './chunk.js'
import { scoreRelevance } from './jevClient.js'
import { decideAction } from './policy.js'
import { DEFAULT_POLICY, type Entry, type PruneDecision, type PruningPolicy } from './types.js'

export * from './types.js'
export { summarizeSavings, type SavingsReport } from './savings.js'
export { estimateTokens } from './tokenEstimate.js'

/**
 * Score every entry's relevance to `goal` via Jev, then apply `policy` to decide what to
 * keep, drop, or summarize. Entries are chunked into batches for the underlying fan-out
 * requests; order of the returned decisions matches the input order.
 */
export async function pruneContext(
  entries: Entry[],
  goal: string,
  policy: PruningPolicy = DEFAULT_POLICY,
): Promise<PruneDecision[]> {
  const chunks = chunkEntries(entries)
  const verdicts = (await Promise.all(chunks.map((chunk) => scoreRelevance(goal, chunk)))).flat()

  const verdictByEntryId = new Map(verdicts.map((v) => [v.entryId, v]))
  return entries.map((entry) => {
    const verdict = verdictByEntryId.get(entry.id)
    if (!verdict) {
      throw new Error(`no Jev verdict returned for entry ${entry.id}`)
    }
    return {
      entryId: entry.id,
      action: decideAction(verdict.relevance, policy),
      relevance: verdict.relevance,
    }
  })
}
