import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Runs the built CLI (dist/index.js) as a subprocess, offline, so no key or network is needed.
// Run `pnpm build` first if dist/ doesn't exist yet.
const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')

function run(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args], { env: { ...process.env, TYPESAFE_API_KEY: '' } })
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
  dir = await mkdtemp(join(tmpdir(), 'ctxjev-prune-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ctxjev prune', () => {
  it('writes ctxjev-format entries back out with the dropped ones removed', async () => {
    const file = join(dir, 't.json')
    await writeFile(
      file,
      JSON.stringify({
        goal: 'fix the checkout double charge on retry',
        entries: [
          { id: 'a', role: 'tool', content: 'chargeCustomer() is called again by the retry handler', timestamp: 1 },
          { id: 'b', role: 'tool', content: 'listed public/audio', timestamp: 2 },
        ],
      }),
    )

    const result = await run(['prune', file, '--offline'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).entries.map((e: { id: string }) => e.id)).toEqual(['a'])
    expect(result.stderr).toContain('removed 1 of 2 entries')
  }, 15_000)

  it('writes an Anthropic Messages conversation to --out with tool pairs intact', async () => {
    const file = join(dir, 'm.json')
    const out = join(dir, 'out.json')
    await writeFile(
      file,
      JSON.stringify([
        { role: 'user', content: 'fix the checkout double charge on retry' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls public' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'favicon.ico' }] },
        { role: 'assistant', content: 'the retry handler re-charges on checkout' },
        { role: 'user', content: 'ok' },
      ]),
    )

    const result = await run(['prune', file, '--offline', '--out', out])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    const messages = JSON.parse(await readFile(out, 'utf8'))
    expect(Array.isArray(messages)).toBe(true)
    const blocks = messages.flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : []))
    expect(blocks.some((b: { type: string }) => b.type === 'tool_use' || b.type === 'tool_result')).toBe(false)
  }, 15_000)

  it('reports the tokens actually removed, not the size of the excerpt it scored', async () => {
    const file = join(dir, 'big.json')
    await writeFile(
      file,
      JSON.stringify([
        { role: 'user', content: 'fix the checkout double charge on retry' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat access.log' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'GET /static/asset.png 200 12ms\n'.repeat(2000) }] },
        { role: 'assistant', content: 'the retry handler re-charges on checkout' },
        { role: 'user', content: 'ok' },
      ]),
    )

    const result = await run(['prune', file, '--offline', '--out', join(dir, 'out.json')])
    expect(result.exitCode).toBe(0)
    const tokens = Number(/~([\d,]+) tokens/.exec(result.stderr)?.[1].replace(/,/g, ''))
    expect(tokens).toBeGreaterThan(10_000)
  }, 15_000)

  it('prints the help for `prune --help` instead of rejecting the flag', async () => {
    const result = await run(['prune', '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage')
  }, 15_000)

  it('refuses to write back a Claude Code transcript', async () => {
    const file = join(dir, 's.jsonl')
    await writeFile(file, JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the bug please now' } }))

    const result = await run(['prune', file, '--offline'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("can't write back a Claude Code transcript")
  }, 15_000)
})
