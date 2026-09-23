import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Exercises the actual shipped artifact (dist/preCompact.js), not src/preCompact.ts — this is
// what hooks/hooks.json invokes, and it's the file that has previously shipped broken (0.1.7's
// missing dist/, 0.1.8's unresolvable ctxjev-core import) without any test catching it. Run
// `pnpm build` first if dist/preCompact.js doesn't exist yet.
const distPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'preCompact.js')

function run(stdin: string, env: Record<string, string | undefined> = {}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [distPath], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
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
  cwd = await mkdtemp(join(tmpdir(), 'ctxjev-preCompact-test-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('preCompact.js (dist)', () => {
  it('exits 0 without crashing on malformed JSON stdin', async () => {
    const result = await run('not json at all')
    expect(result.exitCode).toBe(0)
  }, 10_000)

  it('exits 0 without crashing on empty stdin', async () => {
    const result = await run('')
    expect(result.exitCode).toBe(0)
  }, 10_000)

  it('no-ops silently when cwd/transcript_path are missing, even with a key set', async () => {
    const result = await run(JSON.stringify({}), { TYPESAFE_API_KEY: 'fake-key-for-this-test' })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
  }, 10_000)

  it('without TYPESAFE_API_KEY, scores offline, sends nothing, and says so in last-run.json', async () => {
    const transcriptPath = join(cwd, 'transcript.jsonl')
    await writeFile(
      transcriptPath,
      [
        { type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the checkout double charge on retry' } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Grep', input: { pattern: 'charge' } }] } },
        { type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'chargeCustomer() is called again by the retry handler' }] } },
        { type: 'assistant', uuid: 'a2', timestamp: '2026-01-01T00:00:03.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'listing the audio folder' }] } },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n'),
      'utf8',
    )

    const result = await run(JSON.stringify({ cwd, transcript_path: transcriptPath, session_id: 'sess-1' }), { TYPESAFE_API_KEY: undefined })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const lastRun = JSON.parse(await readFile(join(cwd, '.ctxjev', 'last-run.json'), 'utf8'))
    expect(lastRun).toMatchObject({ outcome: 'preserved', scorer: 'local', goalSource: 'inferred', preserved: 1, sessionId: 'sess-1' })
    expect(lastRun.note).toContain('TYPESAFE_API_KEY')

    const preserved = JSON.parse(await readFile(join(cwd, '.ctxjev', 'preserved', 'sess-1.json'), 'utf8'))
    expect(preserved.scorer).toBe('local')
    expect(preserved.entries.map((e: { entryId: string }) => e.entryId)).toEqual(['c1'])
    expect(await readFile(join(cwd, '.ctxjev', '.gitignore'), 'utf8')).toBe('*\n')
  }, 10_000)

  it('records an unreadable transcript as an error instead of failing silently', async () => {
    const result = await run(JSON.stringify({ cwd, transcript_path: join(cwd, 'does-not-exist.jsonl') }), { TYPESAFE_API_KEY: undefined })
    expect(result.exitCode).toBe(0)

    const lastRun = JSON.parse(await readFile(join(cwd, '.ctxjev', 'last-run.json'), 'utf8'))
    expect(lastRun.outcome).toBe('error')
    expect(lastRun.reason).toContain('does-not-exist.jsonl')
  }, 10_000)

  it('clears a stale snapshot from an earlier compaction instead of leaving it for sessionStartCompact.js to re-inject', async () => {
    await mkdir(join(cwd, '.ctxjev', 'preserved'), { recursive: true })
    await writeFile(
      join(cwd, '.ctxjev', 'preserved', 'sess-1.json'),
      JSON.stringify({ goal: 'an unrelated earlier task', scoredAt: '2020-01-01T00:00:00.000Z', entries: [] }),
      'utf8',
    )

    // No API key — this hits an early return, the exact case the bug report described (a stale
    // file surviving because a *later* PreCompact run bailed out before ever writing a fresh one).
    const result = await run(JSON.stringify({ cwd, transcript_path: join(cwd, 'transcript.jsonl'), session_id: 'sess-1' }), { TYPESAFE_API_KEY: undefined })
    expect(result.exitCode).toBe(0)
    await expect(readFile(join(cwd, '.ctxjev', 'preserved', 'sess-1.json'), 'utf8')).rejects.toThrow()
  }, 10_000)

  it('falls back to offline scoring when Jev misses the deadline, and says why', async () => {
    const transcriptPath = join(cwd, 'transcript.jsonl')
    await writeFile(
      transcriptPath,
      [
        { type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the checkout double charge on retry' } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'the retry handler charges twice' }] } },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n'),
      'utf8',
    )

    const result = await run(JSON.stringify({ cwd, transcript_path: transcriptPath, session_id: 'sess-1' }), {
      TYPESAFE_API_KEY: 'not-a-real-key',
      CTXJEV_JEV_TIMEOUT_MS: '1',
    })
    expect(result.exitCode).toBe(0)

    const lastRun = JSON.parse(await readFile(join(cwd, '.ctxjev', 'last-run.json'), 'utf8'))
    expect(lastRun).toMatchObject({ outcome: 'preserved', scorer: 'local' })
    expect(lastRun.note).toContain('within')
  }, 10_000)
})
