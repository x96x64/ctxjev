import { type Entry, type ScoredEntry } from 'ctxjev-core';
export type SelectedEntry = ScoredEntry & {
    content: string;
};
/**
 * Scores every entry against `goal` and returns the top `limit` by combined score — this is the
 * one function here that calls the live Jev API, kept separate so it's the one thing
 * select.live.test.ts needs a key for.
 */
export declare function selectPreserved(entries: Entry[], goal: string, limit?: number): Promise<SelectedEntry[]>;
