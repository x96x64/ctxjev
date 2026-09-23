import { scoreEntries, type Entry, type ScoredEntry } from 'ctxjev-core'

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
  return rankForPreservation(scored, entries, goal, limit)
}

/**
 * Leaves out the message the goal came from (the reminder's header already shows it), and anything
 * with zero relevance, which shouldn't take a slot just for being recent.
 */
export function rankForPreservation(scored: ScoredEntry[], entries: Entry[], goal: string, limit: number): SelectedEntry[] {
  const contentByEntryId = new Map(entries.map((e) => [e.id, e.content]))
  return scored
    .map((s) => ({ ...s, content: contentByEntryId.get(s.entryId) ?? '' }))
    .filter((s) => s.relevance > 0 && s.content.trim() !== goal.trim())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
}

/** CTXJEV_PRESERVE_LIMIT, if it's a whole number from 1 to 50; otherwise the default. */
export function preserveLimitFromEnv(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_PRESERVE_LIMIT
}
