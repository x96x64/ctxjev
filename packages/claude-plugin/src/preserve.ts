import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile, redactSecrets, type ScoredEntry } from 'ctxjev-core'
import type { Scorer } from './select.js'
import { ensureSessionDir, sessionDir, sessionDirProblem, stateFileProblem } from './stateDir.js'

export type PreservedContext = {
  goal: string
  scoredAt: string
  scorer: Scorer
  entries: Array<ScoredEntry & { content: string }>
}

const FILE = 'preserved.json'

export async function writePreservedContext(cwd: string, sessionId: string | undefined, data: PreservedContext): Promise<void> {
  const dir = await ensureSessionDir(cwd, sessionId)
  // Masked here, not just where it's sent to Jev: a /ctxjev:set-goal goal is the user's own text,
  // and excerpts scored offline never went through a Jev request at all.
  const masked: PreservedContext = { ...data, goal: redactSecrets(data.goal), entries: data.entries.map((e) => ({ ...e, content: redactSecrets(e.content) })) }
  // Atomic, so a concurrent run can't interleave with this write and corrupt the JSON.
  await atomicWriteFile(join(dir, FILE), JSON.stringify(masked, null, 2), { mode: 0o600 })
}

/**
 * Masked again on the way out, since what's read here is re-injected into the conversation (the
 * digest) or shown (the status report): a snapshot written by an earlier version, whose masking
 * missed `Error: DB_PASSWORD=…` and similar, must not bring the secret back.
 */
export async function readPreservedContext(cwd: string, sessionId: string | undefined): Promise<PreservedContext | undefined> {
  if (await sessionDirProblem(cwd, sessionId)) return undefined
  const path = join(sessionDir(cwd, sessionId), FILE)
  if (await stateFileProblem(path)) return undefined
  let data: PreservedContext
  try {
    data = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null || typeof data.goal !== 'string' || !Array.isArray(data.entries)) return undefined
  const entries = data.entries.filter((e) => typeof e === 'object' && e !== null && typeof e.content === 'string' && typeof e.combinedScore === 'number' && Number.isFinite(e.combinedScore))
  return { ...data, goal: redactSecrets(data.goal), entries: entries.map((e) => ({ ...e, content: redactSecrets(e.content) })) }
}

/** Why readPreservedContext() would refuse to read the snapshot, if it would (for the status report). */
export async function preservedContextProblem(cwd: string, sessionId: string | undefined): Promise<string | undefined> {
  return (await sessionDirProblem(cwd, sessionId)) ?? (await stateFileProblem(join(sessionDir(cwd, sessionId), FILE)))
}

/** Called before any of preCompact's early returns, so an earlier compaction's snapshot is never re-injected as current. */
export async function clearPreservedContext(cwd: string, sessionId: string | undefined): Promise<void> {
  // Nothing is deleted from a directory another user owns; from the user's own, even one others
  // could write to, the stale snapshot is removed, so it can't come back once the directory is private.
  if (await sessionDirProblem(cwd, sessionId, { forDelete: true })) return
  await rm(join(sessionDir(cwd, sessionId), FILE), { force: true })
}
