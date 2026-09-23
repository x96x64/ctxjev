import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { inferGoalFromEntries, type Entry } from 'ctxjev-core'

export type ResolvedGoal = {
  goal: string
  source: 'explicit' | 'inferred'
  /** An explicit goal that was ignored because it was set before this session started. */
  ignoredStaleGoal?: string
}

/**
 * An explicit goal (`/ctxjev:set-goal`, written to .ctxjev/goal.txt) wins, but only if it was set
 * during this session — one left over from last week's work shouldn't silently steer today's.
 * Otherwise the most recent user chat message stands in for it.
 */
export async function resolveGoal(cwd: string, entries: Entry[], sessionStartedAt?: number): Promise<ResolvedGoal | undefined> {
  const explicit = await readGoalFile(cwd)
  const isCurrent = explicit && (sessionStartedAt === undefined || explicit.setAt >= sessionStartedAt)
  if (explicit && isCurrent) return { goal: explicit.text, source: 'explicit' }

  const inferred = inferGoalFromEntries(entries)
  if (!inferred) return undefined
  return explicit ? { goal: inferred, source: 'inferred', ignoredStaleGoal: explicit.text } : { goal: inferred, source: 'inferred' }
}

async function readGoalFile(cwd: string): Promise<{ text: string; setAt: number } | undefined> {
  const path = join(cwd, '.ctxjev', 'goal.txt')
  try {
    const text = (await readFile(path, 'utf8')).trim()
    if (text.length === 0) return undefined
    return { text, setAt: (await stat(path)).mtimeMs }
  } catch {
    return undefined
  }
}
