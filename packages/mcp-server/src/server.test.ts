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
      const result = await client.callTool({ name, arguments: { goal: 'fix the double charge', entries } })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('TYPESAFE_API_KEY is not set')
    }
    await client.close()
  })

  it('still rejects invalid input first', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'prune_history', arguments: { goal: '', entries } })
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
    await client.connect(transport)
    try {
      expect((await client.listTools()).tools).toHaveLength(2)
      const result = await client.callTool({ name: 'score_relevance', arguments: { goal: 'fix the double charge', entries } })
      expect(result.isError).toBe(true)
    } finally {
      await client.close()
    }
  }, 15_000)
})
