#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

async function main() {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error('ctxjev-mcp: TYPESAFE_API_KEY is not set — get one at console.typesafe.ai/settings/keys')
    process.exit(1)
  }

  const server = createServer()
  await server.connect(new StdioServerTransport())
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
