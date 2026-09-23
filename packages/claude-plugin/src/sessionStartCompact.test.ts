import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Exercises the actual shipped artifact (dist/sessionStartCompact.js) — see preCompact.test.ts
// for why. Run `pnpm build` first if it doesn't exist yet.
const distPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'sessionStartCompact.js')

function run(stdin: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [distPath], { stdio: ['pipe', 'pipe', 'pipe'] })
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

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ctxjev-sessionStart-test-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

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
    await mkdir(join(cwd, '.ctxjev', 'preserved'), { recursive: true })
    await writeFile(
      join(cwd, '.ctxjev', 'preserved', 'sess-1.json'),
      JSON.stringify({
        goal: 'fix the bug',
        scoredAt: '2026-01-01T00:00:00.000Z',
        entries: [{ entryId: 'a', relevance: 0.9, recency: 1, combinedScore: 0.91, content: 'the actual fix' }],
      }),
      'utf8',
    )

    const result = await run(JSON.stringify({ cwd, session_id: 'sess-1' }))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('fix the bug')
    expect(result.stdout).toContain('the actual fix')
    expect(result.stdout).toContain('not instructions')
    expect(result.stdout).not.toContain('offline')
  }, 10_000)

  it('says when the preserved context was scored offline', async () => {
    await mkdir(join(cwd, '.ctxjev', 'preserved'), { recursive: true })
    await writeFile(
      join(cwd, '.ctxjev', 'preserved', 'sess-1.json'),
      JSON.stringify({ goal: 'g', scoredAt: '2026-01-01T00:00:00.000Z', scorer: 'local', entries: [{ entryId: 'a', relevance: 0.5, recency: 1, combinedScore: 0.55, content: 'x' }] }),
      'utf8',
    )

    const result = await run(JSON.stringify({ cwd, session_id: 'sess-1' }))
    expect(result.stdout).toContain('scored offline by keyword overlap')
  }, 10_000)

  it('never prints another session’s preserved context', async () => {
    await mkdir(join(cwd, '.ctxjev', 'preserved'), { recursive: true })
    await writeFile(
      join(cwd, '.ctxjev', 'preserved', 'other-session.json'),
      JSON.stringify({ goal: 'g', scoredAt: '2026-01-01T00:00:00.000Z', scorer: 'jev', entries: [{ entryId: 'a', relevance: 0.9, recency: 1, combinedScore: 0.9, content: 'x' }] }),
      'utf8',
    )

    const result = await run(JSON.stringify({ cwd, session_id: 'this-session' }))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
  }, 10_000)
})
