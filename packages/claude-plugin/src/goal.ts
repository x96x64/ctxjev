import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Entry } from 'ctxjev-core'

/**
 * Explicit beats inferred: `/ctxjev:set-goal` writes .ctxjev/goal.txt, which always wins when
 * present. Otherwise, the most recent user chat message stands in for "what's this session
 * about right now" — not perfect, but a session with no explicit goal set is exactly the case
 * where guessing is better than not scoring at all.
 */
export async function resolveGoal(cwd: string, entries: Entry[]): Promise<string | undefined> {
  const explicit = await readGoalFile(cwd)
  if (explicit) return explicit

  const lastUserEntry = [...entries].reverse().find((e) => e.role === 'user')
  return lastUserEntry?.content
}

async function readGoalFile(cwd: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(cwd, '.ctxjev', 'goal.txt'), 'utf8')
    const trimmed = text.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch {
    return undefined
  }
}
