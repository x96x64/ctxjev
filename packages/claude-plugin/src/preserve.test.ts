import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPreservedContext, writePreservedContext, type PreservedContext } from './preserve.js'

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
  entries: [{ entryId: 'a', relevance: 0.9, recency: 1, combinedScore: 0.91, content: 'the fix' }],
}

describe('preserve cache', () => {
  it('round-trips through write and read', async () => {
    await writePreservedContext(cwd, sample)
    expect(await readPreservedContext(cwd)).toEqual(sample)
  })

  it('creates the .ctxjev directory if missing', async () => {
    await expect(writePreservedContext(cwd, sample)).resolves.not.toThrow()
  })

  it('gitignores the .ctxjev directory so cached transcript excerpts never get committed', async () => {
    await writePreservedContext(cwd, sample)
    expect(await readFile(join(cwd, '.ctxjev', '.gitignore'), 'utf8')).toBe('*\n')
  })

  it('leaves an existing .ctxjev/.gitignore untouched', async () => {
    await mkdir(join(cwd, '.ctxjev'), { recursive: true })
    await writeFile(join(cwd, '.ctxjev', '.gitignore'), 'custom\n', 'utf8')
    await writePreservedContext(cwd, sample)
    expect(await readFile(join(cwd, '.ctxjev', '.gitignore'), 'utf8')).toBe('custom\n')
  })

  it('returns undefined when no cache exists yet', async () => {
    expect(await readPreservedContext(cwd)).toBeUndefined()
  })
})
