import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { subprocessEnv } from '../../../test-support/subprocessEnv.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Exercises the actual shipped artifact (dist/sessionStartCompact.js) — see preCompact.test.ts
// for why. Run `pnpm build` first if it doesn't exist yet.
const distPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'sessionStartCompact.js')

function run(stdin: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [distPath], { env: subprocessEnv({ CTXJEV_STATE_DIR: state }), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

let cwd: string
let state: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ctxjev-sessionStart-test-'))
  state = await mkdtemp(join(tmpdir(), 'ctxjev-sessionStart-state-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(state, { recursive: true, force: true })
})

async function writeSnapshot(sessionId: string, snapshot: unknown) {
  await mkdir(join(state, 'sessions', sessionId), { recursive: true })
  await writeFile(join(state, 'sessions', sessionId, 'preserved.json'), JSON.stringify(snapshot), 'utf8')
}

describe('sessionStartCompact.js (dist)', () => {
  it('exits 0 without crashing on malformed JSON stdin', async () => {
    const result = await run('not json at all')
    expect(result.exitCode).toBe(0)
  }, 10_000)

  it('exits 0 and prints nothing when cwd is missing', async () => {
    const result = await run(JSON.stringify({}))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
  }, 10_000)

  it('exits 0 and prints nothing when no preserved context exists yet', async () => {
    const result = await run(JSON.stringify({ cwd }))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
  }, 10_000)

  it('prints the preserved context, framed as quoted excerpts rather than instructions', async () => {
    await writeSnapshot('sess-1', {
        goal: 'fix the bug',
        scoredAt: '2026-01-01T00:00:00.000Z',
        entries: [{ entryId: 'a', relevance: 0.9, recency: 1, combinedScore: 0.91, content: 'the actual fix' }],
      })

    const result = await run(JSON.stringify({ cwd, session_id: 'sess-1' }))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('fix the bug')
    expect(result.stdout).toContain('the actual fix')
    expect(result.stdout).toContain('not instructions')
    expect(result.stdout).toContain('any question in them was already asked')
    expect(result.stdout).toContain('«the actual fix»')
    expect(result.stdout).not.toContain('offline')
  }, 10_000)

  it('says when the preserved context was scored offline', async () => {
    await writeSnapshot('sess-1', { goal: 'g', scoredAt: '2026-01-01T00:00:00.000Z', scorer: 'local', entries: [{ entryId: 'a', relevance: 0.5, recency: 1, combinedScore: 0.55, content: 'x' }] })

    const result = await run(JSON.stringify({ cwd, session_id: 'sess-1' }))
    expect(result.stdout).toContain('scored offline by keyword overlap')
  }, 10_000)

  it('never prints another session’s preserved context', async () => {
    await writeSnapshot('other-session', { goal: 'g', scoredAt: '2026-01-01T00:00:00.000Z', scorer: 'jev', entries: [{ entryId: 'a', relevance: 0.9, recency: 1, combinedScore: 0.9, content: 'x' }] })

    const result = await run(JSON.stringify({ cwd, session_id: 'this-session' }))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
  }, 10_000)
})
