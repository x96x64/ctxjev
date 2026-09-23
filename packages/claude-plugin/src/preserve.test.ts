import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearPreservedContext, readPreservedContext, writePreservedContext, type PreservedContext } from './preserve.js'
import { removeLegacyState, sessionKey } from './stateDir.js'

let cwd: string
let state: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ctxjev-preserve-project-'))
  state = await mkdtemp(join(tmpdir(), 'ctxjev-preserve-state-'))
  process.env.CTXJEV_STATE_DIR = state
})

afterEach(async () => {
  delete process.env.CTXJEV_STATE_DIR
  await rm(cwd, { recursive: true, force: true })
  await rm(state, { recursive: true, force: true })
})

const sample: PreservedContext = {
  goal: 'fix the bug',
  scoredAt: '2026-01-01T00:00:00.000Z',
  scorer: 'jev',
  entries: [{ entryId: 'a', relevance: 0.9, recency: 1, combinedScore: 0.91, content: 'the fix' }],
}

describe('preserve cache', () => {
  it('round-trips through write and read', async () => {
    await writePreservedContext(cwd, 'session-a', sample)
    expect(await readPreservedContext(cwd, 'session-a')).toEqual(sample)
  })

  it('writes nothing into the project', async () => {
    await writePreservedContext(cwd, 'session-a', sample)
    expect(await readdir(cwd)).toEqual([])
  })

  it('keeps the snapshot readable only by the user', async () => {
    await writePreservedContext(cwd, 'session-a', sample)
    const mode = (await stat(join(state, 'sessions', 'session-a', 'preserved.json'))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('returns undefined when no cache exists yet', async () => {
    expect(await readPreservedContext(cwd, 'session-a')).toBeUndefined()
  })

  it('keeps one snapshot per session, so two sessions on the same project never see each other’s', async () => {
    await writePreservedContext(cwd, 'session-a', sample)
    await writePreservedContext(cwd, 'session-b', { ...sample, goal: 'something else' })
    expect((await readPreservedContext(cwd, 'session-a'))?.goal).toBe('fix the bug')
    expect((await readPreservedContext(cwd, 'session-b'))?.goal).toBe('something else')

    await clearPreservedContext(cwd, 'session-a')
    expect(await readPreservedContext(cwd, 'session-a')).toBeUndefined()
    expect(await readPreservedContext(cwd, 'session-b')).toBeDefined()
  })

  it('falls back to a per-project key for a missing or unsafe session id', () => {
    expect(sessionKey('3f2b9c1e-7d4a-4c1b-9e0f-1a2b3c4d5e6f', cwd)).toBe('3f2b9c1e-7d4a-4c1b-9e0f-1a2b3c4d5e6f')
    expect(sessionKey(undefined, cwd)).toMatch(/^default-[0-9a-f]{16}$/)
    expect(sessionKey('../../etc/passwd', cwd)).toBe(sessionKey(undefined, cwd))
    expect(sessionKey(undefined, '/some/other/project')).not.toBe(sessionKey(undefined, cwd))
  })

  it('keeps only the 50 most recent sessions', async () => {
    for (let i = 0; i < 55; i++) await writePreservedContext(cwd, `s${i}`, sample)
    expect((await readdir(join(state, 'sessions'))).length).toBe(50)
  })
})

describe('removeLegacyState', () => {
  it('removes what earlier versions wrote into the project, and the directory once empty', async () => {
    await mkdir(join(cwd, '.ctxjev', 'preserved'), { recursive: true })
    for (const f of ['last-run.json', 'goal.txt', '.gitignore', 'preserved-context.json']) await writeFile(join(cwd, '.ctxjev', f), 'x')
    await removeLegacyState(cwd)
    expect(await readdir(cwd)).toEqual([])
  })

  it('leaves files it did not write, and the directory holding them', async () => {
    await mkdir(join(cwd, '.ctxjev'), { recursive: true })
    await writeFile(join(cwd, '.ctxjev', 'last-run.json'), 'x')
    await writeFile(join(cwd, '.ctxjev', 'notes.md'), 'mine')
    await removeLegacyState(cwd)
    expect(await readdir(join(cwd, '.ctxjev'))).toEqual(['notes.md'])
  })

  it('does nothing without a .ctxjev directory', async () => {
    await expect(removeLegacyState(cwd)).resolves.toBeUndefined()
  })
})
