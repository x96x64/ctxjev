import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { subprocessEnv } from '../../../test-support/subprocessEnv.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The shipped dist/statusHook.js, run the way Claude Code runs a UserPromptSubmit hook.
const here = dirname(fileURLToPath(import.meta.url))
const distPath = join(here, '..', 'dist', 'statusHook.js')
const noisy = join(here, '../../../examples/sample-transcripts/claude-code-noisy-session.jsonl')

let state: string

beforeEach(async () => {
  state = await mkdtemp(join(tmpdir(), 'ctxjev-statusHook-'))
})

afterEach(async () => {
  await rm(state, { recursive: true, force: true })
})

function run(stdin: string, script = distPath): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script], { env: subprocessEnv({ CTXJEV_STATE_DIR: state }), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout }))
    child.stdin.end(stdin)
  })
}

describe('statusHook.js (dist)', () => {
  it('answers /ctxjev:status by blocking the prompt with the report', async () => {
    const result = await run(JSON.stringify({ prompt: '/ctxjev:status', cwd: state, session_id: 's1', transcript_path: noisy }))
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.decision).toBe('block')
    expect(output.reason).toContain('ctxjev status — session s1')
    expect(output.reason).toContain('«Stop checkout from charging twice on retry; keep retries at 3»')
  }, 10_000)

  it('lets every other prompt through untouched', async () => {
    for (const prompt of ['fix the bug', '/ctxjev:set-goal ship it', '/ctxjev:status please', '/compact']) {
      const result = await run(JSON.stringify({ prompt, cwd: state, session_id: 's1' }))
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
    }
  }, 10_000)

  // The fourth audit (P2-13): the hook runs on every prompt, and loaded the whole status report
  // (state files, transcript parsing, masking) before looking at the prompt. It now loads status.js
  // only for /ctxjev:status: copied without it, the hook still passes an ordinary prompt through,
  // and has nothing to answer /ctxjev:status with.
  it('loads the status report only for /ctxjev:status', async () => {
    const alone = join(state, 'hook-alone')
    await rm(alone, { recursive: true, force: true })
    await mkdir(alone)
    await copyFile(distPath, join(alone, 'statusHook.js'))
    const ordinary = await run(JSON.stringify({ prompt: 'fix the bug', cwd: state, session_id: 's1' }), join(alone, 'statusHook.js'))
    expect(ordinary).toEqual({ exitCode: 0, stdout: '' })
    const status = await run(JSON.stringify({ prompt: '/ctxjev:status', cwd: state, session_id: 's1', transcript_path: noisy }), join(alone, 'statusHook.js'))
    expect(status).toEqual({ exitCode: 0, stdout: '' })
    // What every prompt loads: the check, not the report.
    expect((await stat(distPath)).size).toBeLessThan(4_000)
  }, 10_000)

  it('stays out of the way on bad input', async () => {
    const result = await run('not json')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
  }, 10_000)
})
