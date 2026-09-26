import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { subprocessEnv } from '../../../test-support/subprocessEnv.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The third audit (check 18): `ctxjev analyze` on one 5,000,000-character entry hadn't finished
// after 120 seconds, because counting its tokens was quadratic in the length of the run.
const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')

function run(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args], { env: subprocessEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctxjev-large-input-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ctxjev analyze on a 5,000,000-character entry', () => {
  // `/` with line breaks, and symbols with a combining accent, are one pre-token of mixed kinds:
  // the first fix left them whole, and 1,000,000 characters of `/\n` didn't finish in 150 seconds,
  // while 200,000 of `!!` plus an accent ended with "Maximum call stack size exceeded".
  it.each([
    ['x', 'x'],
    ['█', '█'],
    ['/ and a line break', '/\n'],
    ['!! and a combining accent', '!!\u0301'],
  ])('of %s finishes in under 30 seconds', async (_name, unit) => {
    const file = join(dir, 'big.json')
    await writeFile(
      file,
      JSON.stringify({
        goal: 'find the separator line',
        entries: [
          { id: 'big', role: 'tool', toolName: 'bash', content: unit.repeat(5_000_000 / unit.length + 1).slice(0, 5_000_000), timestamp: 1 },
          { id: 'small', role: 'assistant', content: 'done', timestamp: 2 },
        ],
      }),
    )
    const start = Date.now()
    const result = await run(['analyze', file])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('(of 2 entries)')
    expect(Date.now() - start).toBeLessThan(30_000)
  }, 60_000)
})
