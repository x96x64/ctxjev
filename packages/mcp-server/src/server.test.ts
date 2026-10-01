import { createServer as createHttpServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subprocessEnv } from '../../../test-support/subprocessEnv.js'
import { createServer } from './server.js'

/**
 * The MCP wiring without a key: tools are listed, and a call says what's missing instead of the
 * server exiting at startup (which a host could only show as "connection closed"). The Jev path
 * itself is in server.live.test.ts.
 */
const entries = [
  { id: 'a', role: 'tool', toolName: 'grep', content: 'found chargeCustomer() called twice on retry', timestamp: 0 },
  { id: 'b', role: 'tool', toolName: 'ls', content: 'listed public/audio', timestamp: 1 },
]

async function connect(): Promise<Client> {
  const server = createServer()
  const client = new Client({ name: 'ctxjev-mcp-test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

// 1.0: a call that names no scorer runs offline (`local`), like every other entry point, even with a
// key set; only an explicit `scorer: "jev"` sends anything.
describe('MCP server, default scorer', () => {
  const received: string[] = []
  let jev: Server
  beforeEach(async () => {
    received.length = 0
    jev = createHttpServer((req, res) => {
      received.push(`${req.method} ${req.url}`)
      res.writeHead(500)
      res.end()
    })
    await new Promise<void>((resolve) => jev.listen(0, '127.0.0.1', resolve))
    vi.stubEnv('TYPESAFE_API_KEY', 'not-a-real-key')
    vi.stubEnv('TYPESAFE_BASE_URL', `http://127.0.0.1:${(jev.address() as AddressInfo).port}`)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    jev.closeAllConnections()
    jev.close()
  })

  it('is local: with a key set, a call that names no scorer scores offline and sends nothing', async () => {
    const client = await connect()
    const scored = await client.callTool({ name: 'score_relevance', arguments: { goal: 'fix the double charge', entries } })
    expect(scored.isError, JSON.stringify(scored.content)).toBeFalsy()
    expect(JSON.parse((scored.content as Array<{ text: string }>)[0].text).usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    const pruned = await client.callTool({ name: 'prune_history', arguments: { goal: 'fix the double charge', entries } })
    expect(pruned.isError, JSON.stringify(pruned.content)).toBeFalsy()
    expect(received).toEqual([])
    const { tools } = await client.listTools()
    for (const tool of tools) expect((tool.inputSchema.properties as Record<string, { default?: string }>).scorer?.default).toBe('local')
    await client.close()
  })
})

// Codex (0.159.3) passes an Agent Plugins bundle's `"TYPESAFE_API_KEY": "${TYPESAFE_API_KEY}"`
// through unexpanded. The server took it for a key and sent masked excerpts to Jev, which refused them.
describe('MCP server with an unexpanded ${TYPESAFE_API_KEY}', () => {
  const received: string[] = []
  let jev: Server
  beforeEach(async () => {
    received.length = 0
    jev = createHttpServer((req, res) => {
      received.push(`${req.method} ${req.url}`)
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"error":"unauthorized"}')
    })
    await new Promise<void>((resolve) => jev.listen(0, '127.0.0.1', resolve))
    vi.stubEnv('TYPESAFE_API_KEY', '${TYPESAFE_API_KEY}')
    vi.stubEnv('TYPESAFE_BASE_URL', `http://127.0.0.1:${(jev.address() as AddressInfo).port}`)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    jev.closeAllConnections()
    jev.close()
  })

  it('treats it as no key: a call that uses Jev says so, and nothing is sent', async () => {
    const client = await connect()
    for (const name of ['score_relevance', 'prune_history']) {
      const result = await client.callTool({ name, arguments: { goal: 'fix the double charge', entries, scorer: 'jev' } })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('TYPESAFE_API_KEY')
      expect(JSON.stringify(result.content)).toContain('placeholder')
    }
    expect(received).toEqual([])
    await client.close()
  })
})

describe('MCP server without TYPESAFE_API_KEY', () => {
  beforeEach(() => void vi.stubEnv('TYPESAFE_API_KEY', ''))
  afterEach(() => void vi.unstubAllEnvs())

  it('lists both tools with their input schemas', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['prune_history', 'score_relevance'])
    for (const tool of tools) expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['goal', 'entries']))
    await client.close()
  })

  it('answers a tool call with an isError result naming the missing key', async () => {
    const client = await connect()
    for (const name of ['score_relevance', 'prune_history']) {
      const result = await client.callTool({ name, arguments: { goal: 'fix the double charge', entries, scorer: 'jev' } })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('TYPESAFE_API_KEY is not set')
    }
    await client.close()
  })

  // The fourth audit (P1-5): both tools were Jev-only, so without a key they were unusable.
  it('scores offline with scorer "local" or "recency", with no key and nothing sent', async () => {
    const client = await connect()
    for (const scorer of ['local', 'recency']) {
      const scored = await client.callTool({ name: 'score_relevance', arguments: { goal: 'fix the double charge', entries, scorer } })
      expect(scored.isError, JSON.stringify(scored.content)).toBeFalsy()
      const body = JSON.parse((scored.content as Array<{ text: string }>)[0].text)
      expect(body.scored.map((s: { entryId: string }) => s.entryId).sort()).toEqual(['a', 'b'])
      expect(body.usage).toEqual({ inputTokens: 0, outputTokens: 0 })

      const pruned = await client.callTool({ name: 'prune_history', arguments: { goal: 'fix the double charge', entries, scorer } })
      expect(pruned.isError, JSON.stringify(pruned.content)).toBeFalsy()
      const decided = JSON.parse((pruned.content as Array<{ text: string }>)[0].text)
      expect(decided.decisions).toHaveLength(2)
      expect(decided.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    }
    await client.close()
  })

  it('lists scorer in both tools\' input schemas, and says the key is needed for jev only', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    for (const tool of tools) {
      const scorer = (tool.inputSchema.properties as Record<string, { enum?: string[]; default?: string }>).scorer
      expect(scorer?.enum).toEqual(['jev', 'local', 'recency'])
      expect(scorer?.default).toBe('local')
    }
    const result = await client.callTool({ name: 'prune_history', arguments: { goal: 'fix the double charge', entries, scorer: 'jev' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('scorer')
    await client.close()
  })

  it('rejects an unknown scorer', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'score_relevance', arguments: { goal: 'fix the double charge', entries, scorer: 'bm25' } })
    expect(result.isError).toBe(true)
    // Rejected as input, not answered with the missing key.
    expect(JSON.stringify(result.content)).toContain('scorer')
    expect(JSON.stringify(result.content)).not.toContain('TYPESAFE_API_KEY')
    await client.close()
  })

  // The fifth audit (check D1): an unknown argument (`policy`, a misspelt `recencyweight`) was
  // dropped in silence, so the call ran on the defaults the caller meant to change.
  it('rejects an unknown argument instead of ignoring it', async () => {
    const client = await connect()
    const calls = [
      { name: 'prune_history', arguments: { goal: 'fix the double charge', entries, scorer: 'local', policy: { dropBelow: 0.9 } } },
      { name: 'score_relevance', arguments: { goal: 'fix the double charge', entries, scorer: 'local', recencyweight: 0.5 } },
    ]
    for (const call of calls) {
      const result = await client.callTool(call)
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toMatch(/policy|recencyweight/)
      expect(JSON.stringify(result.content)).not.toContain('TYPESAFE_API_KEY')
    }
    await client.close()
  })

  // The fifth audit (improvement 11): score_relevance returned 'local''s raw keyword overlap while
  // prune_history ranked it within the batch, so the same entry scored differently in the two.
  it('scores an entry on the same scale in both tools under scorer "local"', async () => {
    const client = await connect()
    const goal = 'retry charge customer twice payment'
    const mixed = ['retry charge customer', 'retry', 'listed public audio', 'charge twice payment retry'].map((content, i) => ({ id: `e${i}`, role: 'tool', content, timestamp: i }))
    const scored = JSON.parse(((await client.callTool({ name: 'score_relevance', arguments: { goal, entries: mixed, scorer: 'local' } })).content as Array<{ text: string }>)[0].text)
    const pruned = JSON.parse(((await client.callTool({ name: 'prune_history', arguments: { goal, entries: mixed, scorer: 'local' } })).content as Array<{ text: string }>)[0].text)
    const byId = (list: Array<{ entryId: string; relevance: number; combinedScore: number }>) => Object.fromEntries(list.map((s) => [s.entryId, [s.relevance, s.combinedScore]]))
    expect(byId(scored.scored)).toEqual(byId(pruned.decisions))
    await client.close()
  })

  // scorer "jev", or no key check would run at all and the second expectation would prove nothing.
  it('still rejects invalid input first', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'prune_history', arguments: { goal: '', entries, scorer: 'jev' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).not.toContain('TYPESAFE_API_KEY')
    await client.close()
  })
})

describe('dist/index.js without TYPESAFE_API_KEY', () => {
  it('starts, lists its tools, and answers a call with an error instead of exiting', async () => {
    const client = new Client({ name: 'ctxjev-mcp-test-client', version: '0.0.0' })
    const distPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')
    const transport = new StdioClientTransport({ command: process.execPath, args: [distPath], env: subprocessEnv(), stderr: 'pipe' })
    let stderr = ''
    transport.stderr?.on('data', (d) => (stderr += d))
    await client.connect(transport)
    try {
      expect((await client.listTools()).tools).toHaveLength(2)
      const result = await client.callTool({ name: 'score_relevance', arguments: { goal: 'fix the double charge', entries, scorer: 'jev' } })
      expect(result.isError).toBe(true)
      const offline = await client.callTool({ name: 'prune_history', arguments: { goal: 'fix the double charge', entries, scorer: 'local' } })
      expect(offline.isError, JSON.stringify(offline.content)).toBeFalsy()
      // The startup note said every call would fail without a key, which scorer 'local' disproves.
      expect(stderr).toContain('scorer "jev" returns an error until there is one')
    } finally {
      await client.close()
    }
  }, 15_000)
})
