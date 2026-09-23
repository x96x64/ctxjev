import { join } from 'node:path'
import { atomicWriteFile } from 'ctxjev-core'
import { ensureStateDir } from './stateDir.js'

/**
 * What the most recent PreCompact run did and why. A hook's failures are invisible to the user by
 * design (it must never block compaction), so without this a missing API key or an empty
 * transcript looks exactly like "working, nothing to show" — `/ctxjev:status` reads it back.
 */
export type LastRun = {
  at: string
  outcome: 'preserved' | 'skipped' | 'error'
  reason?: string
  goal?: string
  goalSource?: 'explicit' | 'inferred'
  ignoredStaleGoal?: string
  entriesScored?: number
  preserved?: number
}

function lastRunPath(cwd: string): string {
  return join(cwd, '.ctxjev', 'last-run.json')
}

export async function writeLastRun(cwd: string, run: LastRun): Promise<void> {
  await ensureStateDir(cwd)
  await atomicWriteFile(lastRunPath(cwd), JSON.stringify(run, null, 2))
}
