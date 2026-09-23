import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Entry } from 'ctxjev-core'
import { resolveGoal } from './goal.js'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ctxjev-goal-test-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('resolveGoal', () => {
  it('prefers .ctxjev/goal.txt when present', async () => {
    await mkdir(join(cwd, '.ctxjev'))
    await writeFile(join(cwd, '.ctxjev', 'goal.txt'), 'explicit goal\n')

    const entries: Entry[] = [{ id: 'a', role: 'user', content: 'last message', timestamp: 0 }]
    expect(await resolveGoal(cwd, entries)).toEqual({ goal: 'explicit goal', source: 'explicit' })
  })

  it('falls back to the most recent user entry when no goal file exists', async () => {
    const entries: Entry[] = [
      { id: 'a', role: 'user', content: 'first message', timestamp: 0 },
      { id: 'b', role: 'assistant', content: 'a reply', timestamp: 1 },
      { id: 'c', role: 'user', content: 'latest message', timestamp: 2 },
    ]
    expect(await resolveGoal(cwd, entries)).toEqual({ goal: 'latest message', source: 'inferred' })
  })

  it('returns undefined when there is no goal file and no user entry', async () => {
    const entries: Entry[] = [{ id: 'a', role: 'assistant', content: 'reply only', timestamp: 0 }]
    expect(await resolveGoal(cwd, entries)).toBeUndefined()
  })

  it('ignores an empty or whitespace-only goal file', async () => {
    await mkdir(join(cwd, '.ctxjev'))
    await writeFile(join(cwd, '.ctxjev', 'goal.txt'), '   \n')

    const entries: Entry[] = [{ id: 'a', role: 'user', content: 'fallback message', timestamp: 0 }]
    expect(await resolveGoal(cwd, entries)).toEqual({ goal: 'fallback message', source: 'inferred' })
  })

  it('uses an explicit goal set during the current session', async () => {
    await mkdir(join(cwd, '.ctxjev'))
    await writeFile(join(cwd, '.ctxjev', 'goal.txt'), 'this session goal')
    const sessionStartedAt = Date.now() - 60_000

    const entries: Entry[] = [{ id: 'a', role: 'user', content: 'last message', timestamp: 0 }]
    expect(await resolveGoal(cwd, entries, sessionStartedAt)).toEqual({ goal: 'this session goal', source: 'explicit' })
  })

  it('ignores an explicit goal set before this session started, and reports it', async () => {
    await mkdir(join(cwd, '.ctxjev'))
    const goalPath = join(cwd, '.ctxjev', 'goal.txt')
    await writeFile(goalPath, 'last week goal')
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    await utimes(goalPath, lastWeek, lastWeek)

    const entries: Entry[] = [{ id: 'a', role: 'user', content: 'today message', timestamp: 0 }]
    expect(await resolveGoal(cwd, entries, Date.now() - 60_000)).toEqual({
      goal: 'today message',
      source: 'inferred',
      ignoredStaleGoal: 'last week goal',
    })
  })
})
