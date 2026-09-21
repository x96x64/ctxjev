import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inferGoalFromEntries } from 'ctxjev-core';
/**
 * Explicit beats inferred: `/ctxjev:set-goal` writes .ctxjev/goal.txt, which always wins when
 * present. Otherwise, the most recent user chat message (via ctxjev-core's
 * `inferGoalFromEntries`) stands in for "what's this session about right now" — not perfect, but
 * a session with no explicit goal set is exactly the case where guessing is better than not
 * scoring at all.
 */
export async function resolveGoal(cwd, entries) {
    const explicit = await readGoalFile(cwd);
    if (explicit)
        return explicit;
    return inferGoalFromEntries(entries);
}
async function readGoalFile(cwd) {
    try {
        const text = await readFile(join(cwd, '.ctxjev', 'goal.txt'), 'utf8');
        const trimmed = text.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=goal.js.map