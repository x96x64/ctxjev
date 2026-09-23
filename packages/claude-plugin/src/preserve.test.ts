import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearPreservedContext, readPreservedContext, sessionKey, writePreservedContext, type PreservedContext } from './preserve.js'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ctxjev-preserve-test-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
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

  it('creates the .ctxjev directory if missing', async () => {
    await expect(writePreservedContext(cwd, 'session-a', sample)).resolves.not.toThrow()
  })

  it('gitignores the .ctxjev directory so cached transcript excerpts never get committed', async () => {
    await writePreservedContext(cwd, 'session-a', sample)
    expect(await readFile(join(cwd, '.ctxjev', '.gitignore'), 'utf8')).toBe('*\n')
  })

  it('leaves an existing .ctxjev/.gitignore untouched', async () => {
    await mkdir(join(cwd, '.ctxjev'), { recursive: true })
    await writeFile(join(cwd, '.ctxjev', '.gitignore'), 'custom\n', 'utf8')
    await writePreservedContext(cwd, 'session-a', sample)
    expect(await readFile(join(cwd, '.ctxjev', '.gitignore'), 'utf8')).toBe('custom\n')
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

  it('falls back to a shared key for a missing or unsafe session id', () => {
    expect(sessionKey('3f2b9c1e-7d4a-4c1b-9e0f-1a2b3c4d5e6f')).toBe('3f2b9c1e-7d4a-4c1b-9e0f-1a2b3c4d5e6f')
    expect(sessionKey(undefined)).toBe('default')
    expect(sessionKey('../../etc/passwd')).toBe('default')
  })

  it('keeps only the 20 most recent sessions', async () => {
    for (let i = 0; i < 25; i++) await writePreservedContext(cwd, `s${i}`, sample)
    expect((await readdir(join(cwd, '.ctxjev', 'preserved'))).length).toBe(20)
  })

  it('removes the pre-0.3.0 single-file snapshot when clearing', async () => {
    await mkdir(join(cwd, '.ctxjev'), { recursive: true })
    await writeFile(join(cwd, '.ctxjev', 'preserved-context.json'), '{}', 'utf8')
    await clearPreservedContext(cwd, 'session-a')
    await expect(readFile(join(cwd, '.ctxjev', 'preserved-context.json'), 'utf8')).rejects.toThrow()
  })
})
