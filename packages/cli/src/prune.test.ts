import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { subprocessEnv } from '../../../test-support/subprocessEnv.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Runs the built CLI (dist/index.js) as a subprocess, offline, so no key or network is needed.
// Run `pnpm build` first if dist/ doesn't exist yet.
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

  it('fits a budget, shortens summarize entries, and reports the prompt-cache cost', async () => {
    const file = join(dir, 'budget.json')
    const out = join(dir, 'budget-out.json')
    const log = (name: string) => `${name}\n${'checkout retry charge log line\n'.repeat(400)}`
    await writeFile(
      file,
      JSON.stringify([
        { role: 'user', content: 'fix the checkout double charge on retry' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat retry.log' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: log('retry.log') }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'cat charge.log' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: log('charge.log') }] },
        { role: 'assistant', content: 'the retry handler re-charges on checkout' },
        { role: 'user', content: 'ok' },
      ]),
    )

    const result = await run(['prune', file, '--offline', '--out', out, '--target-tokens', '3000', '--summarize-excerpts', '--summarize-below', '1'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toMatch(/shortened \d+/)
    expect(result.stderr).toMatch(/prompt cache: rewritten from message \d+ on/)
    const blocks = JSON.parse(await readFile(out, 'utf8')).flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : []))
    const uses = blocks.filter((b: { type: string }) => b.type === 'tool_use').map((b: { id: string }) => b.id)
    const results = blocks.filter((b: { type: string }) => b.type === 'tool_result').map((b: { tool_use_id: string }) => b.tool_use_id)
    expect(results).toEqual(uses)
  }, 15_000)

  it('leaves the conversation alone when --min-saved-tokens is not met', async () => {
    const file = join(dir, 'small.json')
    const messages = [
      { role: 'user', content: 'fix the checkout double charge on retry' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls public' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'favicon.ico' }] },
      { role: 'assistant', content: 'the retry handler re-charges on checkout' },
      { role: 'user', content: 'ok' },
    ]
    await writeFile(file, JSON.stringify(messages))

    const result = await run(['prune', file, '--offline', '--min-saved-tokens', '5000'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(messages)
    expect(result.stderr).toContain('left unchanged')
  }, 15_000)

  it('rejects Messages-only flags on a ctxjev-format transcript', async () => {
    const file = join(dir, 'c.json')
    await writeFile(file, JSON.stringify({ goal: 'g', entries: [{ id: 'a', role: 'tool', content: 'x', timestamp: 1 }] }))
    const result = await run(['prune', file, '--offline', '--target-tokens', '10'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--target-tokens only applies to an Anthropic Messages transcript')
  }, 15_000)

  // The second audit: --protect-last on ctxjev's own format was accepted and silently ignored.
  it('rejects --protect-last and --no-protect-last-turn on a ctxjev-format transcript', async () => {
    const file = join(dir, 'c.json')
    await writeFile(file, JSON.stringify({ goal: 'g', entries: [{ id: 'a', role: 'tool', content: 'x', timestamp: 1 }] }))
    for (const flags of [['--protect-last', '5'], ['--no-protect-last-turn']]) {
      const result = await run(['prune', file, '--offline', ...flags])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(`${flags[0]} only applies to an Anthropic Messages transcript`)
    }
  }, 15_000)

  it('protects the latest turn unless --no-protect-last-turn, and never reports a non-positive saving as saved', async () => {
    const file = join(dir, 'turn.json')
    const tool = (id: string, out: string) => [
      { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: `cat ${id}.log` } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: out }] },
    ]
    const messages = [
      { role: 'user', content: 'fix the checkout double charge on retry' },
      { role: 'user', content: 'now check the logs' },
      ...tool('a', 'GET /static/asset.png 200\n'.repeat(200)),
      ...tool('b', 'GET /static/icon.png 200\n'.repeat(200)),
      ...tool('c', 'done'),
    ]
    await writeFile(file, JSON.stringify(messages))

    const kept = await run(['prune', file, '--target-tokens', '50'])
    expect(kept.exitCode).toBe(0)
    expect(JSON.parse(kept.stdout)).toEqual(messages)
    expect(kept.stderr).toContain('no tokens saved')
    expect(kept.stderr).not.toMatch(/~-?\d[\d,]* tokens saved/)

    const pruned = await run(['prune', file, '--target-tokens', '50', '--no-protect-last-turn'])
    expect(pruned.exitCode).toBe(0)
    expect(JSON.parse(pruned.stdout).length).toBeLessThan(messages.length)
    expect(pruned.stderr).toMatch(/~[1-9][\d,]* tokens saved/)
  }, 15_000)

  // 0.6.0 printed "3 marked drop but protected" for this sample, but only the first message is
  // protected there: the other two drops were skipped because the removal note outweighed them.
  it('says why each drop in the Anthropic Messages sample was kept, calling only real protection "protected"', async () => {
    const sample = join(dirname(cliPath), '..', '..', '..', 'examples', 'sample-transcripts', 'anthropic-messages.json')
    const result = await run(['prune', sample, '--out', join(dir, 'out.json')])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('removed 0 of 8 entries, no tokens saved')
    expect(result.stderr).not.toContain('marked drop but protected')
    expect(result.stderr).toContain('3 marked drop but kept: 1 protected as the first message; 2 not removed, since removing them would save no tokens once the removal note is counted')
  }, 15_000)

  it('refuses to write back a Claude Code transcript', async () => {
    const file = join(dir, 's.jsonl')
    await writeFile(file, JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the bug please now' } }))

    const result = await run(['prune', file, '--offline'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("can't write back a Claude Code transcript")
  }, 15_000)
})

describe('--scorer', () => {
  const entries = JSON.stringify({
    goal: 'fix the checkout double charge on retry',
    entries: [
      { id: 'a', role: 'tool', content: 'chargeCustomer() is called again by the retry handler', timestamp: 1 },
      { id: 'b', role: 'tool', content: 'listed public/audio', timestamp: 2 },
    ],
  })

  it('recency keeps the newest, whatever it says, with no key', async () => {
    const file = join(dir, 't.json')
    await writeFile(file, entries)
    const result = await run(['prune', file, '--scorer', 'recency'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).entries.map((e: { id: string }) => e.id)).toEqual(['b'])
    expect(result.stderr).toContain('scored by position alone')
  }, 15_000)

  it('rejects an unknown scorer', async () => {
    const file = join(dir, 't.json')
    await writeFile(file, entries)
    const result = await run(['analyze', file, '--scorer', 'magic'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--scorer must be one of jev, local, recency')
  }, 15_000)
})

describe('ctxjev flags', () => {
  // The CLI README said --help and --version work before or after the command; --version after one
  // failed with "Unknown option '--version'".
  it('prints the version before or after the command', async () => {
    const version = JSON.parse(await readFile(join(dirname(cliPath), '..', 'package.json'), 'utf8')).version
    for (const args of [['--version'], ['analyze', '--version'], ['prune', '-v'], ['analyze', 'missing.json', '--version']]) {
      const result = await run(args)
      expect(result.exitCode, args.join(' ')).toBe(0)
      expect(result.stdout.trim()).toBe(version)
    }
  }, 15_000)

  it('names an unknown option plainly and points at --help', async () => {
    const result = await run(['analyze', 'x.json', '--scorr', 'jev'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unknown option '--scorr' for `ctxjev analyze`")
    expect(result.stderr).toContain('ctxjev --help')
    expect(result.stderr).not.toContain('To specify a positional argument')
  }, 15_000)
})
