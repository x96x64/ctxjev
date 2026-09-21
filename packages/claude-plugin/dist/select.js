import { scoreEntries } from 'ctxjev-core';
/**
 * Scores every entry against `goal` and returns the top `limit` by combined score — this is the
 * one function here that calls the live Jev API, kept separate so it's the one thing
 * select.live.test.ts needs a key for.
 */
export async function selectPreserved(entries, goal, limit = 5) {
    if (entries.length === 0)
        return [];
    const scored = await scoreEntries(entries, goal);
    const contentByEntryId = new Map(entries.map((e) => [e.id, e.content]));
    return scored
        .slice()
        .sort((a, b) => b.combinedScore - a.combinedScore)
        .slice(0, limit)
        .map((s) => ({ ...s, content: contentByEntryId.get(s.entryId) ?? '' }));
}
//# sourceMappingURL=select.js.map