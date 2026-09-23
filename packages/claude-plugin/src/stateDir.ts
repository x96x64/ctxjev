import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises'
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

// Everything versions before 0.6.0 wrote into `<project>/.ctxjev/`.
const LEGACY_FILES = ['preserved', 'preserved-context.json', 'last-run.json', 'goal.txt', '.gitignore']

/**
 * Removes the state earlier versions kept in the user's project. Only ctxjev's own files: if
 * anything else is in `.ctxjev/`, that stays, and so does the directory.
 */
export async function removeLegacyState(cwd: string): Promise<void> {
  const dir = join(cwd, '.ctxjev')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  await Promise.all(names.filter((n) => LEGACY_FILES.includes(n)).map((n) => rm(join(dir, n), { recursive: true, force: true })))
  if (names.every((n) => LEGACY_FILES.includes(n))) await rmdir(dir).catch(() => {})
}
