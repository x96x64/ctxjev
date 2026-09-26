import { chmod, chown, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureSessionDir } from './stateDir.js'

// The third audit (check 25): state directories created by the plugin were 0700, but one that
// already existed as 0755 (an earlier version, another tool, a hand-made directory) stayed 0755.
const posix = process.platform !== 'win32'
const isRoot = process.getuid?.() === 0

let root: string
let saved: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ctxjev-statedir-test-'))
  saved = process.env.CTXJEV_STATE_DIR
  process.env.CTXJEV_STATE_DIR = join(root, 'ctxjev')
})

afterEach(async () => {
  if (saved === undefined) delete process.env.CTXJEV_STATE_DIR
  else process.env.CTXJEV_STATE_DIR = saved
  await rm(root, { recursive: true, force: true })
})

const mode = async (path: string) => (await stat(path)).mode & 0o777

describe.skipIf(!posix)('ensureSessionDir', () => {
  it('creates the state root, sessions/, and the session directory private to the user', async () => {
    const dir = await ensureSessionDir(root, 'sess-1')
    for (const path of [join(root, 'ctxjev'), join(root, 'ctxjev', 'sessions'), dir]) expect(await mode(path)).toBe(0o700)
  })

  it('tightens directories that already exist with looser permissions to 0700', async () => {
    const dirs = [join(root, 'ctxjev'), join(root, 'ctxjev', 'sessions'), join(root, 'ctxjev', 'sessions', 'sess-1')]
    for (const path of dirs) {
      await mkdir(path, { recursive: true })
      await chmod(path, 0o755)
    }
    await ensureSessionDir(root, 'sess-1')
    for (const path of dirs) expect(await mode(path)).toBe(0o700)
  })

  // Only root can hand a directory to another user, so this runs where the tests run as root.
  it.skipIf(!isRoot)('refuses a state directory that belongs to another user', async () => {
    const sessions = join(root, 'ctxjev', 'sessions')
    await mkdir(sessions, { recursive: true })
    await chown(sessions, 65534, 65534)
    await expect(ensureSessionDir(root, 'sess-1')).rejects.toThrow(/belongs to another user/)
  })
})
