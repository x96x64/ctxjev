import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Where the plugin keeps its state: `~/.claude/ctxjev/` (or under `CLAUDE_CONFIG_DIR`), never the
 * user's project, since it holds transcript excerpts. `CTXJEV_STATE_DIR` overrides it for tests
 * and the eval. The hooks and `status.js` (run from a skill's Bash call) must agree on this path,
 * which is why it depends on nothing only the hook environment has.
 */
export function stateRoot(): string {
  return process.env.CTXJEV_STATE_DIR || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'ctxjev')
}

const MAX_KEPT_SESSIONS = 50

/**
 * A filesystem-safe key for a Claude Code session id (a UUID in practice). Without a usable one,
 * a per-project key, so two projects can't share a snapshot.
 */
export function sessionKey(sessionId: string | undefined, cwd: string): string {
  if (sessionId && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return sessionId
  return `default-${createHash('sha256').update(resolve(cwd)).digest('hex').slice(0, 16)}`
}

export function sessionDir(cwd: string, sessionId: string | undefined): string {
  return join(stateRoot(), 'sessions', sessionKey(sessionId, cwd))
}

/** Creates the session's directory (private to the user), and drops the oldest sessions' state. */
export async function ensureSessionDir(cwd: string, sessionId: string | undefined): Promise<string> {
  const dir = sessionDir(cwd, sessionId)
  await mkdir(stateRoot(), { recursive: true, mode: 0o700 })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await pruneOldSessions()
  return dir
}

async function pruneOldSessions(): Promise<void> {
  const root = join(stateRoot(), 'sessions')
  const names = await readdir(root)
  if (names.length <= MAX_KEPT_SESSIONS) return
  const withTimes = await Promise.all(names.map(async (name) => ({ name, mtime: (await stat(join(root, name))).mtimeMs })))
  withTimes.sort((a, b) => b.mtime - a.mtime)
  await Promise.all(withTimes.slice(MAX_KEPT_SESSIONS).map(({ name }) => rm(join(root, name), { recursive: true, force: true })))
}

// What versions before 0.6.0 wrote into `<project>/.ctxjev/`: these files, plus one snapshot per
// session in `preserved/` (`<session key>.json`, and a leftover `.tmp` from an interrupted write).
const LEGACY_FILES = ['preserved-context.json', 'last-run.json', 'goal.txt', '.gitignore']
const LEGACY_SNAPSHOT = /^[A-Za-z0-9_-]{1,128}\.json$/
const LEGACY_TEMP = /^[A-Za-z0-9_-]{1,128}\.json\.[0-9a-f-]{36}\.tmp$/

/**
 * Removes the state earlier versions kept in the user's project, one known file at a time and never
 * recursively: anything else in `.ctxjev/` or `.ctxjev/preserved/` stays, and so does the directory
 * holding it. A `preserved/*.json` is only removed if it has a snapshot's shape, since a user's own
 * `notes.json` would match by name alone.
 */
export async function removeLegacyState(cwd: string): Promise<void> {
  const dir = join(cwd, '.ctxjev')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const preserved = join(dir, 'preserved')
  if (names.includes('preserved') && (await lstat(preserved)).isDirectory()) {
    for (const name of await readdir(preserved)) {
      if (LEGACY_TEMP.test(name) || (LEGACY_SNAPSHOT.test(name) && (await isLegacySnapshot(join(preserved, name))))) await unlinkFile(join(preserved, name))
    }
    await rmdir(preserved).catch(() => {})
  }
  for (const name of names.filter((n) => LEGACY_FILES.includes(n))) await unlinkFile(join(dir, name))
  await rmdir(dir).catch(() => {})
}

async function isLegacySnapshot(path: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isFile()) return false
    const data = JSON.parse(await readFile(path, 'utf8'))
    return typeof data?.goal === 'string' && typeof data?.scoredAt === 'string' && Array.isArray(data?.entries)
  } catch {
    return false
  }
}

/** Removes `path` only if it's a plain file: never a directory, and never whatever a symlink points at. */
async function unlinkFile(path: string): Promise<void> {
  try {
    const info = await lstat(path)
    if (info.isFile() || info.isSymbolicLink()) await unlink(path)
  } catch {
    // already gone, or not ours to remove
  }
}
