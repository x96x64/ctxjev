import { scoreEntries, type Entry, type ScoredEntry } from 'ctxjev-core'

export type SelectedEntry = ScoredEntry & { content: string }

/**
 * Scores every entry against `goal` and returns the top `limit` by combined score — this is the
 * one function here that calls the live Jev API, kept separate so it's the one thing
 * select.live.test.ts needs a key for.
 */
export async function selectPreserved(entries: Entry[], goal: string, limit = 5): Promise<SelectedEntry[]> {
  if (entries.length === 0) return []

  const scored = await scoreEntries(entries, goal)
  const contentByEntryId = new Map(entries.map((e) => [e.id, e.content]))

  return scored
    .slice()
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
    .map((s) => ({ ...s, content: contentByEntryId.get(s.entryId) ?? '' }))
}
