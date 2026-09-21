import { type Entry } from 'ctxjev-core';
/**
 * Explicit beats inferred: `/ctxjev:set-goal` writes .ctxjev/goal.txt, which always wins when
 * present. Otherwise, the most recent user chat message (via ctxjev-core's
 * `inferGoalFromEntries`) stands in for "what's this session about right now" — not perfect, but
 * a session with no explicit goal set is exactly the case where guessing is better than not
 * scoring at all.
 */
export declare function resolveGoal(cwd: string, entries: Entry[]): Promise<string | undefined>;
