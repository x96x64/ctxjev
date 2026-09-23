import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile, type ScoredEntry } from 'ctxjev-core'
import type { Scorer } from './select.js'
import { ensureStateDir } from './stateDir.js'

export type PreservedContext = {
  goal: string
  scoredAt: string
  scorer: Scorer
  entries: Array<ScoredEntry & { content: string }>
}

// One snapshot per session, so two sessions open on the same project can't hand each other's
// preserved context back after compaction.
const SESSIONS_DIR = 'preserved'
const MAX_KEPT_SESSIONS = 20

/** A filesystem-safe key for a Claude Code session id (a UUID in practice), or `default` without one. */
export function sessionKey(sessionId: string | undefined): string {
  return sessionId && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? sessionId : 'default'
}

function snapshotPath(cwd: string, sessionId: string | undefined): string {
  return join(cwd, '.ctxjev', SESSIONS_DIR, `${sessionKey(sessionId)}.json`)
}

export async function writePreservedContext(cwd: string, sessionId: string | undefined, data: PreservedContext): Promise<void> {
  const dir = join(await ensureStateDir(cwd), SESSIONS_DIR)
  await mkdir(dir, { recursive: true })
  // Atomic write — a plain writeFile can interleave with a concurrent run and corrupt the JSON.
  await atomicWriteFile(snapshotPath(cwd, sessionId), JSON.stringify(data, null, 2))
  await pruneOldSnapshots(dir)
}

export async function readPreservedContext(cwd: string, sessionId: string | undefined): Promise<PreservedContext | undefined> {
  try {
    return JSON.parse(await readFile(snapshotPath(cwd, sessionId), 'utf8'))
  } catch {
    return undefined
  }
}

/** preCompact.ts has several early-return paths (no entries, no goal, nothing selected) that skip
 * writing a fresh snapshot — call this before any of them so a stale snapshot from an earlier
 * compaction never lingers for sessionStartCompact.ts to re-inject as if it were current. */
export async function clearPreservedContext(cwd: string, sessionId: string | undefined): Promise<void> {
  await rm(snapshotPath(cwd, sessionId), { force: true })
  await rm(join(cwd, '.ctxjev', 'preserved-context.json'), { force: true }) // pre-0.3.0 single-file location
}

async function pruneOldSnapshots(dir: string): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  if (files.length <= MAX_KEPT_SESSIONS) return
  const withTimes = await Promise.all(files.map(async (f) => ({ f, mtime: (await stat(join(dir, f))).mtimeMs })))
  withTimes.sort((a, b) => b.mtime - a.mtime)
  await Promise.all(withTimes.slice(MAX_KEPT_SESSIONS).map(({ f }) => rm(join(dir, f), { force: true })))
}
