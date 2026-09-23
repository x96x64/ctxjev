import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createServer } from './server.js'

/**
 * Exercises the actual MCP wiring (tool registration, zod schemas, response shape) end to end
 * over an in-process transport — tools.test.ts covers the underlying logic in isolation, this
 * covers the MCP-specific plumbing around it. Skipped automatically without TYPESAFE_API_KEY.
 */
// Jev is probabilistic: a retry absorbs a borderline entry flipping once; a real regression fails every attempt.
describe.skipIf(!process.env.TYPESAFE_API_KEY)('MCP server (live, e2e)', { retry: 2 }, () => {
  it('exposes score_relevance and prune_history as callable tools', async () => {
    const server = createServer()
    const client = new Client({ name: 'ctxjev-mcp-test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['score_relevance', 'prune_history']))

    const result = await client.callTool({
      name: 'prune_history',
      arguments: {
        goal: 'fix the double-charge bug in checkout',
        entries: [
          { id: 'relevant', role: 'tool', toolName: 'grep', content: 'found chargeCustomer() called twice on retry', timestamp: 0 },
          { id: 'irrelevant', role: 'tool', toolName: 'ls', content: 'listed public/audio, unrelated', timestamp: 1 },
        ],
      },
    })

    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.decisions).toHaveLength(2)
    expect(parsed.savings.totalEntries).toBe(2)
    expect(parsed.usage.inputTokens).toBeGreaterThan(0)

    await client.close()
    await server.close()
  }, 20_000)
})
