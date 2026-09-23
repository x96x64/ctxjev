import { scoreEntries, type Entry, type ScoredEntry } from 'ctxjev-core'

export type SelectedEntry = ScoredEntry & { content: string }

export const DEFAULT_PRESERVE_LIMIT = 5

/**
 * Scores every entry against `goal` and returns the top `limit` by combined score — this is the
 * one function here that calls the live Jev API, kept separate so it's the one thing
 * select.live.test.ts needs a key for.
 */
export async function selectPreserved(entries: Entry[], goal: string, limit = DEFAULT_PRESERVE_LIMIT): Promise<SelectedEntry[]> {
  if (entries.length === 0) return []

  const scored = await scoreEntries(entries, goal)
  return rankForPreservation(scored, entries, goal, limit)
}

/** The goal is already printed in the reminder's header, so the message it was inferred from would just repeat it. */
export function rankForPreservation(scored: ScoredEntry[], entries: Entry[], goal: string, limit: number): SelectedEntry[] {
  const contentByEntryId = new Map(entries.map((e) => [e.id, e.content]))
  return scored
    .map((s) => ({ ...s, content: contentByEntryId.get(s.entryId) ?? '' }))
    .filter((s) => s.content.trim() !== goal.trim())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
}

/** CTXJEV_PRESERVE_LIMIT, if it's a whole number from 1 to 50; otherwise the default. */
export function preserveLimitFromEnv(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_PRESERVE_LIMIT
}
