import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from 'ctxjev-core'
import type { Scorer } from './select.js'
import { ensureSessionDir, sessionDir } from './stateDir.js'

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
  await atomicWriteFile(join(dir, FILE), JSON.stringify(run, null, 2), { mode: 0o600 })
}

export async function readLastRun(cwd: string, sessionId: string | undefined): Promise<LastRun | undefined> {
  try {
    return JSON.parse(await readFile(join(sessionDir(cwd, sessionId), FILE), 'utf8'))
  } catch {
    return undefined
  }
}
