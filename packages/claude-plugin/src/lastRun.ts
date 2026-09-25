import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile, redactSecrets } from 'ctxjev-core'
import type { Scorer } from './select.js'
import { ensureSessionDir, sessionDir, sessionDirProblem } from './stateDir.js'

/**
 * What the most recent PreCompact run in a session did and why. A hook's failures are invisible by
 * design (it must never block compaction), so `/ctxjev:status` reads this back.
 */
export type LastRun = {
  at: string
  sessionId?: string
  outcome: 'preserved' | 'skipped' | 'error'
  reason?: string
  goal?: string
  goalSource?: 'explicit' | 'inferred'
  entriesScored?: number
  preserved?: number
  scorer?: Scorer
  /** Why scoring fell back to the offline heuristic, when it did. */
  note?: string
  /** Problems in the transcript that were worked around, e.g. records repeating an id. */
  warnings?: string[]
}

const FILE = 'last-run.json'

export async function writeLastRun(cwd: string, run: LastRun): Promise<void> {
  const dir = await ensureSessionDir(cwd, run.sessionId)
  // The goal may be a /ctxjev:set-goal the user typed, and an error message may quote anything.
  const mask = (text: string | undefined) => (text === undefined ? undefined : redactSecrets(text))
  const masked: LastRun = { ...run, goal: mask(run.goal), reason: mask(run.reason), note: mask(run.note), warnings: run.warnings?.map(redactSecrets) }
  await atomicWriteFile(join(dir, FILE), JSON.stringify(masked, null, 2), { mode: 0o600 })
}

/**
 * The session's last run, or why it can't be read: `{}` when no compaction has run yet, `problem`
 * when the file exists but can't be used (which must not read as "no compaction").
 */
export async function readLastRun(cwd: string, sessionId: string | undefined): Promise<{ run?: LastRun; problem?: string }> {
  // A state directory another user owns is refused on write too, so "no compaction" would be wrong.
  const problem = await sessionDirProblem(cwd, sessionId)
  if (problem) return { problem }
  let raw: string
  try {
    raw = await readFile(join(sessionDir(cwd, sessionId), FILE), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'ENOENT' ? {} : { problem: `couldn't read ${FILE} (${code ?? String(err)})` }
  }
  try {
    return { run: JSON.parse(raw) }
  } catch {
    return { problem: `${FILE} isn't valid JSON; the next compaction rewrites it` }
  }
}
