import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { subprocessEnv } from '../../../test-support/subprocessEnv.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Exercises the actual shipped artifact (dist/preCompact.js), not src/preCompact.ts — this is
// what hooks/hooks.json invokes, and it's the file that has previously shipped broken (0.1.7's
// missing dist/, 0.1.8's unresolvable ctxjev-core import) without any test catching it. Run
// `pnpm build` first if dist/preCompact.js doesn't exist yet.
const distPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'preCompact.js')

function run(stdin: string, env: Record<string, string | undefined> = {}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [distPath], { env: subprocessEnv({ CTXJEV_STATE_DIR: state, ...env }), stdio: ['pipe', 'pipe', 'pipe'] })
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
  cwd = await mkdtemp(join(tmpdir(), 'ctxjev-preCompact-test-'))
  state = await mkdtemp(join(tmpdir(), 'ctxjev-preCompact-state-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(state, { recursive: true, force: true })
})

const sessionFile = (sessionId: string, file: string) => join(state, 'sessions', sessionId, file)

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

  it('scores offline by default and sends nothing, even with TYPESAFE_API_KEY set', async () => {
    const transcriptPath = join(cwd, 'transcript.jsonl')
    await writeFile(
      transcriptPath,
      [
        { type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the checkout double charge on retry' } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Grep', input: { pattern: 'charge' } }] } },
        { type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'chargeCustomer() is called again by the retry handler' }] } },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n'),
      'utf8',
    )

    // Jev is a local server that would record any request: with a key but no CTXJEV_SCORER=jev,
    // nothing may arrive.
    const received: string[] = []
    const jev = createServer((req, res) => {
      received.push(`${req.method} ${req.url}`)
      res.statusCode = 500
      res.end()
    })
    await new Promise<void>((resolve) => jev.listen(0, '127.0.0.1', resolve))
    try {
      const result = await run(JSON.stringify({ cwd, transcript_path: transcriptPath, session_id: 'sess-1' }), {
        TYPESAFE_API_KEY: 'not-a-real-key',
        TYPESAFE_BASE_URL: `http://127.0.0.1:${(jev.address() as AddressInfo).port}`,
      })
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(received).toEqual([])

      const lastRun = JSON.parse(await readFile(sessionFile('sess-1', 'last-run.json'), 'utf8'))
      expect(lastRun).toMatchObject({ outcome: 'preserved', scorer: 'local', preserved: 1 })
      expect(lastRun.note).toBeUndefined()
    } finally {
      jev.closeAllConnections()
      jev.close()
    }
  }, 10_000)

  it('with CTXJEV_SCORER=jev but no TYPESAFE_API_KEY, scores offline, sends nothing, and says why in last-run.json', async () => {
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

    const result = await run(JSON.stringify({ cwd, transcript_path: transcriptPath, session_id: 'sess-1' }), { TYPESAFE_API_KEY: undefined, CTXJEV_SCORER: 'jev' })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const lastRun = JSON.parse(await readFile(sessionFile('sess-1', 'last-run.json'), 'utf8'))
    expect(lastRun).toMatchObject({ outcome: 'preserved', scorer: 'local', goalSource: 'inferred', preserved: 1, sessionId: 'sess-1' })
    expect(lastRun.note).toContain('CTXJEV_SCORER=jev')
    expect(lastRun.note).toContain('TYPESAFE_API_KEY')

    const preserved = JSON.parse(await readFile(sessionFile('sess-1', 'preserved.json'), 'utf8'))
    expect(preserved.scorer).toBe('local')
    expect(preserved.entries.map((e: { entryId: string }) => e.entryId)).toEqual(['c1'])
    expect(await readdir(cwd)).toEqual(['transcript.jsonl'])
  }, 10_000)

  it('scores a transcript that repeats a record id, keeping the last and noting it', async () => {
    const transcriptPath = join(cwd, 'transcript.jsonl')
    const first = { type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the checkout double charge on retry' } }
    await writeFile(
      transcriptPath,
      [
        first,
        { type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Grep', input: { pattern: 'charge' } }] } },
        { type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'chargeCustomer() is called again by the retry handler' }] } },
        first,
      ]
        .map((r) => JSON.stringify(r))
        .join('\n'),
      'utf8',
    )

    const result = await run(JSON.stringify({ cwd, transcript_path: transcriptPath, session_id: 'sess-1' }), { TYPESAFE_API_KEY: undefined })
    expect(result.exitCode).toBe(0)
    const lastRun = JSON.parse(await readFile(sessionFile('sess-1', 'last-run.json'), 'utf8'))
    expect(lastRun).toMatchObject({ outcome: 'preserved', scorer: 'local' })
    expect(lastRun.warnings).toEqual([expect.stringContaining('"u1"')])
  }, 10_000)

  it('masks a secret in a /ctxjev:set-goal goal before writing it to disk', async () => {
    const transcriptPath = join(cwd, 'transcript.jsonl')
    await writeFile(
      transcriptPath,
      [
        { type: 'user', uuid: 'u0', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: '<command-name>/ctxjev:set-goal</command-name>\n<command-args>fix the checkout double charge; DB_PASS=hunter2</command-args>' } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Grep', input: { pattern: 'charge' } }] } },
        { type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'chargeCustomer() is called again by the retry handler' }] } },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n'),
      'utf8',
    )
    const result = await run(JSON.stringify({ cwd, transcript_path: transcriptPath, session_id: 'sess-1' }), { TYPESAFE_API_KEY: undefined })
    expect(result.exitCode).toBe(0)
    const lastRun = await readFile(sessionFile('sess-1', 'last-run.json'), 'utf8')
    expect(JSON.parse(lastRun)).toMatchObject({ goalSource: 'explicit', goal: 'fix the checkout double charge; DB_PASS=[REDACTED]' })
    for (const file of await readdir(join(state, 'sessions', 'sess-1'))) {
      expect(await readFile(sessionFile('sess-1', file), 'utf8')).not.toContain('hunter2')
    }
  }, 10_000)

  it('records an unreadable transcript as an error instead of failing silently', async () => {
    const result = await run(JSON.stringify({ cwd, transcript_path: join(cwd, 'does-not-exist.jsonl'), session_id: 'sess-1' }), { TYPESAFE_API_KEY: undefined })
    expect(result.exitCode).toBe(0)

    const lastRun = JSON.parse(await readFile(sessionFile('sess-1', 'last-run.json'), 'utf8'))
    expect(lastRun.outcome).toBe('error')
    expect(lastRun.reason).toContain('does-not-exist.jsonl')
  }, 10_000)

  it('clears a stale snapshot from an earlier compaction instead of leaving it for sessionStartCompact.js to re-inject', async () => {
    await mkdir(join(state, 'sessions', 'sess-1'), { recursive: true })
    await writeFile(
      sessionFile('sess-1', 'preserved.json'),
      JSON.stringify({ goal: 'an unrelated earlier task', scoredAt: '2020-01-01T00:00:00.000Z', entries: [] }),
      'utf8',
    )

    // No API key — this hits an early return, the exact case the bug report described (a stale
    // file surviving because a *later* PreCompact run bailed out before ever writing a fresh one).
    const result = await run(JSON.stringify({ cwd, transcript_path: join(cwd, 'transcript.jsonl'), session_id: 'sess-1' }), { TYPESAFE_API_KEY: undefined })
    expect(result.exitCode).toBe(0)
    await expect(readFile(sessionFile('sess-1', 'preserved.json'), 'utf8')).rejects.toThrow()
  }, 10_000)

  it('with CTXJEV_SCORER=jev, falls back to offline scoring when Jev misses the deadline, and says why', async () => {
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

    // Jev is a local server that takes the request and never answers, so the deadline is what ends
    // the wait. The audit caught this test posting to the real API with a fake key; now nothing
    // leaves the machine, and the request that would have gone out is seen arriving here instead.
    const received: string[] = []
    const jev = createServer((req) => void received.push(`${req.method} ${req.url}`))
    await new Promise<void>((resolve) => jev.listen(0, '127.0.0.1', resolve))
    try {
      const result = await run(JSON.stringify({ cwd, transcript_path: transcriptPath, session_id: 'sess-1' }), {
        TYPESAFE_API_KEY: 'not-a-real-key',
        TYPESAFE_BASE_URL: `http://127.0.0.1:${(jev.address() as AddressInfo).port}`,
        CTXJEV_SCORER: 'jev',
        CTXJEV_JEV_TIMEOUT_MS: '500',
      })
      expect(result.exitCode).toBe(0)

      const lastRun = JSON.parse(await readFile(sessionFile('sess-1', 'last-run.json'), 'utf8'))
      expect(lastRun).toMatchObject({ outcome: 'preserved', scorer: 'local' })
      expect(lastRun.note).toContain('within 0.5s')
      expect(received).toEqual([expect.stringMatching(/^POST \//)])
    } finally {
      jev.closeAllConnections()
      jev.close()
    }
  }, 10_000)

  it('scores against the session’s /ctxjev:set-goal, and clears state older versions left in the project', async () => {
    const transcriptPath = join(cwd, 'transcript.jsonl')
    await writeFile(transcriptPath, await readFile(join(dirname(distPath), '../../../examples/sample-transcripts/claude-code-noisy-session.jsonl'), 'utf8'))
    await mkdir(join(cwd, '.ctxjev', 'preserved'), { recursive: true })
    await writeFile(join(cwd, '.ctxjev', 'goal.txt'), 'a goal another session set')

    const result = await run(JSON.stringify({ cwd, transcript_path: transcriptPath, session_id: 'sess-1' }), { TYPESAFE_API_KEY: undefined })
    expect(result.exitCode).toBe(0)

    const lastRun = JSON.parse(await readFile(sessionFile('sess-1', 'last-run.json'), 'utf8'))
    expect(lastRun).toMatchObject({ goal: 'Stop checkout from charging twice on retry; keep retries at 3', goalSource: 'explicit' })
    expect(await readdir(cwd)).toEqual(['transcript.jsonl'])
  }, 10_000)
})
