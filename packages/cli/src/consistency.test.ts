import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { messagesToEntries, type AnthropicMessage } from 'ctxjev-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { subprocessEnv } from '../../../test-support/subprocessEnv.js'

// Every number `analyze` shows must be what `prune` does with the same input and settings, and
// every number either shows must be what actually happened. Runs the built CLI (dist/index.js).
const here = dirname(fileURLToPath(import.meta.url))
const cliPath = join(here, '..', 'dist', 'index.js')
const sample = (name: string) => join(here, '..', '..', '..', 'examples', 'sample-transcripts', name)

function run(args: string[], env: Record<string, string | undefined> = {}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args], { env: subprocessEnv(env) })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

/** The numbers in a Messages summary, whether `prune` did it or `analyze` says it would. */
function messagesNumbers(text: string) {
  const removed = /(?:removed|would remove) (\d+) of (\d+) entries/.exec(text)
  const shortened = /(?:shortened|shorten) (\d+)/.exec(text)
  const saved = /~([\d,]+) tokens saved/.exec(text)
  const cache = /rewritten from message (\d+) on \(~([\d,]+) tokens/.exec(text)
  const kept = /^(\d+ marked drop but kept: .*)$/m.exec(text)
  return {
    removed: removed ? Number(removed[1]) : undefined,
    of: removed ? Number(removed[2]) : undefined,
    shortened: shortened ? Number(shortened[1]) : 0,
    saved: saved ? Number(saved[1].replace(/,/g, '')) : text.includes('no tokens saved') ? 0 : undefined,
    cache: cache ? [Number(cache[1]), Number(cache[2].replace(/,/g, ''))] : null,
    kept: kept?.[1],
  }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctxjev-consistency-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('analyze and prune agree', () => {
  // 0.6.0's analyze said "~46 / 156 tokens saved by dropping (29%)" here; prune removes nothing.
  it('on the Anthropic Messages sample: nothing would be removed, and the same reasons why', async () => {
    const analyze = await run(['analyze', sample('anthropic-messages.json')])
    const prune = await run(['prune', sample('anthropic-messages.json'), '--out', join(dir, 'out.json')])
    expect(analyze.exitCode).toBe(0)
    expect(prune.exitCode).toBe(0)
    expect(analyze.stdout).not.toContain('tokens saved by dropping')
    expect(analyze.stdout).toContain('prune would remove 0 of 8 entries, no tokens saved')
    expect(prune.stderr).toContain('removed 0 of 8 entries, no tokens saved')
    expect(messagesNumbers(analyze.stdout)).toEqual(messagesNumbers(prune.stderr))
    expect(messagesNumbers(analyze.stdout).kept).toContain('1 protected as the first message; 2 not removed')
  }, 20_000)

  it('on a Messages conversation prune does change, with the same prune settings, and the numbers are what happened', async () => {
    const log = (name: string) => `${name}\n${'GET /static/asset.png 200 12ms\n'.repeat(120)}`
    const tool = (id: string, out: string): AnthropicMessage[] => [
      { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: `cat ${id}.log` } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: out }] },
    ]
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'Fix the checkout double charge on retry.' },
      ...tool('a', log('a.log')),
      ...tool('b', log('b.log')),
      { role: 'user', content: 'Keep retries at 3.' },
      ...tool('c', log('c.log')),
      ...tool('d', log('d.log')),
      { role: 'assistant', content: 'Found it: the retry handler re-charges.' },
      { role: 'user', content: 'Now fix it.' },
      ...tool('e', 'patched'),
    ]
    const file = join(dir, 'conversation.json')
    await writeFile(file, JSON.stringify(messages))

    for (const flags of [[], ['--summarize-excerpts'], ['--no-protect-last-turn', '--target-tokens', '400'], ['--min-saved-tokens', '100000'], ['--no-marker', '--drop-user-text']]) {
      const out = join(dir, 'out.json')
      const analyze = await run(['analyze', file, ...flags])
      const prune = await run(['prune', file, '--out', out, ...flags])
      expect(analyze.exitCode, analyze.stderr).toBe(0)
      expect(prune.exitCode, prune.stderr).toBe(0)
      const would = messagesNumbers(analyze.stdout)
      const did = messagesNumbers(prune.stderr)
      expect(would, `flags ${flags.join(' ')}`).toEqual(did)
      if (flags.includes('--min-saved-tokens')) {
        expect(analyze.stdout).toContain('prune would leave it unchanged')
        expect(prune.stderr).toContain('left unchanged')
        continue
      }

      // What prune reports is what's in the file it wrote.
      const written = JSON.parse(await readFile(out, 'utf8')) as AnthropicMessage[]
      expect(did.removed).toBeGreaterThan(0)
      // The removal note prune adds is new text, not one of the original entries.
      const surviving = messagesToEntries(written).filter((e) => !e.content.startsWith('[ctxjev: '))
      expect(messagesToEntries(messages).length - surviving.length).toBe(did.removed)
      const [firstChanged] = did.cache!
      expect(written.slice(0, firstChanged)).toEqual(messages.slice(0, firstChanged))
      expect(written[firstChanged]).not.toEqual(messages[firstChanged])
    }
  }, 60_000)

  it('on ctxjev’s own format: the entries marked drop, and the same tokens', async () => {
    const analyze = await run(['analyze', sample('checkout-bug.json')])
    const out = join(dir, 'out.json')
    const prune = await run(['prune', sample('checkout-bug.json'), '--out', out])
    expect(analyze.stdout).toContain('prune would remove the 2 entries marked drop, ~27 / 154 tokens (18%)')
    expect(prune.stderr).toContain('removed 2 of 7 entries, ~27 tokens')
    expect(JSON.parse(await readFile(out, 'utf8')).entries).toHaveLength(5)
  }, 20_000)

  it('on a Claude Code transcript: analyze claims no saving, since prune refuses to write one back', async () => {
    const analyze = await run(['analyze', sample('claude-code-session.jsonl')])
    const prune = await run(['prune', sample('claude-code-session.jsonl')])
    expect(prune.exitCode).toBe(1)
    expect(analyze.exitCode).toBe(0)
    expect(analyze.stdout).toContain("prune can't write back a Claude Code transcript, so nothing is removed")
    expect(analyze.stdout).not.toMatch(/tokens saved/)
  }, 20_000)

  it('rejects the Messages-only settings on formats that have no messages, as prune does', async () => {
    for (const file of [sample('checkout-bug.json'), sample('claude-code-session.jsonl')]) {
      const analyze = await run(['analyze', file, '--no-protect-last-turn'])
      expect(analyze.exitCode).toBe(1)
      expect(analyze.stderr).toContain('--no-protect-last-turn only applies to an Anthropic Messages transcript')
    }
  }, 20_000)

  it('analyze --json carries what prune would do for a Messages transcript', async () => {
    const analyze = await run(['analyze', sample('anthropic-messages.json'), '--json'])
    const json = JSON.parse(analyze.stdout)
    expect(json.prune).toMatchObject({ removed: [], summarized: [], savedTokens: 0, keptDrops: { firstMessage: ['msg:0'], noNetSaving: ['msg:1:0', 'tool:toolu_01'] } })
  }, 20_000)
})

describe('verdict words', () => {
  // "3 kept, 2 summarized, 2 dropped" read as things ctxjev had done; analyze does nothing, and prune
  // never shortens an entry unless asked to (--summarize-excerpts, Messages only).
  it('counts verdicts as verdicts, and the legend says summarize is only worth shortening', async () => {
    const analyze = await run(['analyze', sample('checkout-bug.json')])
    expect(analyze.stdout).toContain('3 keep, 2 summarize, 2 drop (of 7 entries)')
    expect(analyze.stdout).toContain('summarize = worth shortening')
    expect(analyze.stdout).not.toMatch(/summarized|dropped|summarize = shorten\b/)
  }, 20_000)
})

describe('--target-tokens', () => {
  // With nothing removed, "what's left is protected" was false: unprotected entries were still there.
  it("doesn't call what's left protected when nothing was removed", async () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: `Fix the checkout double charge on retry. ${'Context about the payment service. '.repeat(40)}` },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt' }] },
      { role: 'user', content: 'Keep retries at 3.' },
      { role: 'user', content: 'Go ahead.' },
      { role: 'assistant', content: `Here is the plan. ${'Step details. '.repeat(40)}` },
    ]
    const file = join(dir, 'budget.json')
    await writeFile(file, JSON.stringify(messages))
    const prune = await run(['prune', file, '--target-tokens', '10'])
    expect(prune.exitCode).toBe(0)
    expect(JSON.parse(prune.stdout)).toEqual(messages)
    expect(prune.stderr).toContain('still over --target-tokens')
    expect(prune.stderr).not.toContain("what's left is protected")
    expect(prune.stderr).toContain('nothing was removed')
  }, 20_000)
})

describe('Jev cost', () => {
  let jev: Server
  let requests = 0
  beforeEach(async () => {
    requests = 0
    // A stand-in for Jev's API: answers every question and reports 1,000 input tokens per entry.
    jev = createServer((req, res) => {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        requests++
        const ids = Object.keys(JSON.parse(body).questions)
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ answers: Object.fromEntries(ids.map((id, i) => [id, { noul: i % 2 ? 0.9 : 0.1 }])), usage: { input_tokens: 1000 * ids.length, output_tokens: ids.length } }))
      })
    })
    await new Promise<void>((resolve) => jev.listen(0, '127.0.0.1', resolve))
  })
  afterEach(() => {
    jev.closeAllConnections()
    jev.close()
  })

  // prune --scorer jev spent money and never said how much.
  it('prune reports the same Jev cost line analyze does, from the usage Jev reported', async () => {
    const env = { TYPESAFE_API_KEY: 'not-a-real-key', TYPESAFE_BASE_URL: `http://127.0.0.1:${(jev.address() as AddressInfo).port}` }
    const analyze = await run(['analyze', sample('checkout-bug.json'), '--scorer', 'jev', '--no-cache'], env)
    const prune = await run(['prune', sample('checkout-bug.json'), '--scorer', 'jev', '--no-cache', '--out', join(dir, 'out.json')], env)
    const line = 'Jev cost: 7,000 input tokens, 7 output tokens (free) — ~$0.000294'
    expect(analyze.stdout).toContain(line)
    expect(prune.stderr).toContain(line)
    expect(requests).toBe(2)
  }, 20_000)
})
