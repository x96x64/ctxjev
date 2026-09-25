#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

async function main() {
  // Start either way: exiting here showed up in the host only as "connection closed". Without a
  // key, the tools are still listed, and each call returns an error saying what's missing.
  if (!process.env.TYPESAFE_API_KEY) {
    console.error('ctxjev-mcp: TYPESAFE_API_KEY is not set, so every tool call will return an error until it is — get one at console.typesafe.ai/settings/keys')
  }

  const server = createServer()
  await server.connect(new StdioServerTransport())
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
