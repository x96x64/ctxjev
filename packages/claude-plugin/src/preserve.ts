import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile, type ScoredEntry } from 'ctxjev-core'
import type { Scorer } from './select.js'
import { ensureSessionDir, sessionDir } from './stateDir.js'

export type PreservedContext = {
  goal: string
  scoredAt: string
  scorer: Scorer
  entries: Array<ScoredEntry & { content: string }>
}

const FILE = 'preserved.json'

export async function writePreservedContext(cwd: string, sessionId: string | undefined, data: PreservedContext): Promise<void> {
  const dir = await ensureSessionDir(cwd, sessionId)
  // Atomic, so a concurrent run can't interleave with this write and corrupt the JSON.
  await atomicWriteFile(join(dir, FILE), JSON.stringify(data, null, 2), { mode: 0o600 })
}

export async function readPreservedContext(cwd: string, sessionId: string | undefined): Promise<PreservedContext | undefined> {
  try {
    return JSON.parse(await readFile(join(sessionDir(cwd, sessionId), FILE), 'utf8'))
  } catch {
    return undefined
  }
}

/** Called before any of preCompact's early returns, so an earlier compaction's snapshot is never re-injected as current. */
export async function clearPreservedContext(cwd: string, sessionId: string | undefined): Promise<void> {
  await rm(join(sessionDir(cwd, sessionId), FILE), { force: true })
}
