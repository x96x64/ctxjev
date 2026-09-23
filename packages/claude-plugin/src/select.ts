import { DEFAULT_POLICY, isGoalCandidate, isSubstantiveMessage, scoreEntries, type Entry, type ScoredEntry } from 'ctxjev-core'

export type SelectedEntry = ScoredEntry & { content: string }

export const DEFAULT_PRESERVE_LIMIT = 5

export type Scorer = 'jev' | 'local'

/**
 * Scores every entry against `goal` and returns the top `limit` by combined score — with Jev by
 * default (the one call here that needs the live API), or offline with `scorer: 'local'`.
 */
export async function selectPreserved(entries: Entry[], goal: string, limit = DEFAULT_PRESERVE_LIMIT, scorer: Scorer = 'jev'): Promise<SelectedEntry[]> {
  if (entries.length === 0) return []

  const scored = await scoreEntries(entries, goal, undefined, { scorer })
  // Jev's probabilities share pruneContext's scale, so anything it would drop doesn't earn a slot
  // either. Keyword overlap isn't on that scale — any overlap at all is its only meaningful bar.
  const minRelevance = scorer === 'jev' ? DEFAULT_POLICY.dropBelow : Number.MIN_VALUE
  return rankForPreservation(scored, entries, goal, limit, minRelevance)
}

/**
 * Leaves out the messages the goal came from (the reminder's header already shows them), a short
 * acknowledgment like "yes, go ahead" (meaningless once what it answered is gone), a command the
 * user ran (`/ctxjev:set-goal …` would only repeat the goal), and anything below `minRelevance`,
 * which shouldn't take a slot just for being recent.
 */
export function rankForPreservation(scored: ScoredEntry[], entries: Entry[], goal: string, limit: number, minRelevance: number): SelectedEntry[] {
  const entryById = new Map(entries.map((e) => [e.id, e]))
  return scored
    .map((s) => ({ ...s, content: entryById.get(s.entryId)?.content ?? '', role: entryById.get(s.entryId)?.role }))
    .filter((s) => s.relevance >= minRelevance && !goal.includes(s.content.trim()))
    .filter((s) => s.role !== 'user' || (isSubstantiveMessage(s.content) && isGoalCandidate(s.content)))
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
    .map(({ role: _role, ...s }) => s)
}

/** CTXJEV_PRESERVE_LIMIT, if it's a whole number from 1 to 50; otherwise the default. */
export function preserveLimitFromEnv(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_PRESERVE_LIMIT
}
