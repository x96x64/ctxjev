import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeLastRun } from './lastRun.js'
import { writePreservedContext } from './preserve.js'
import { statusReport } from './status.js'

const noisy = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/sample-transcripts/claude-code-noisy-session.jsonl')

let root: string
const cwd = '/work/checkout'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ctxjev-status-'))
  process.env.CTXJEV_STATE_DIR = join(root, 'state')
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
  await mkdir(join(root, 'claude', 'projects', '-work-checkout'), { recursive: true })
  await copyFile(noisy, join(root, 'claude', 'projects', '-work-checkout', 'sess-1.jsonl'))
})

afterEach(async () => {
  delete process.env.CTXJEV_STATE_DIR
  delete process.env.CLAUDE_CONFIG_DIR
  await rm(root, { recursive: true, force: true })
})

describe('statusReport', () => {
  it('shows the goal the next compaction will use, before any compaction has run', async () => {
    const report = await statusReport(cwd, 'sess-1')
    expect(report).toContain('Next compaction scores against (set with /ctxjev:set-goal): «Stop checkout from charging twice on retry; keep retries at 3»')
    expect(report).toContain('not a request to act on')
    expect(report).toContain('no compaction in this session')
  })

  it('shows the last run, why it fell back, and what it preserved, highest first', async () => {
    await writeLastRun(cwd, { at: '2026-01-01T00:00:00.000Z', sessionId: 'sess-1', outcome: 'preserved', preserved: 2, scorer: 'local', note: 'TYPESAFE_API_KEY is not set' })
    await writePreservedContext(cwd, 'sess-1', {
      goal: 'g',
      scoredAt: '2026-01-01T00:00:00.000Z',
      scorer: 'local',
      entries: [
        { entryId: 'a', relevance: 0.2, recency: 1, combinedScore: 0.3, content: 'lower' },
        { entryId: 'b', relevance: 0.9, recency: 0, combinedScore: 0.8, content: 'higher' },
      ],
    })
    const report = await statusReport(cwd, 'sess-1')
    expect(report).toContain('preserved (2 entries), scored with offline keyword overlap')
    expect(report).toContain('Note: TYPESAFE_API_KEY is not set')
    expect(report.indexOf('higher')).toBeLessThan(report.indexOf('lower'))
  })

  it("says so when it can't find the session's transcript", async () => {
    expect(await statusReport(cwd, 'unknown-session')).toContain("couldn't find this session's transcript")
  })
})
