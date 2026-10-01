#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { missingTypesafeApiKey } from 'ctxjev-core'
import { createServer } from './server.js'

async function main() {
  // Start either way: exiting here showed up in the host only as "connection closed". Without a
  // key, the tools are still listed, scorer 'local' and 'recency' work, and a call that uses Jev
  // returns an error saying what's missing.
  const missingKey = missingTypesafeApiKey()
  if (missingKey !== undefined) {
    console.error(`ctxjev-mcp: ${missingKey}, so scorer "jev" returns an error until there is one ("local", the default, and "recency" work offline) — get one at console.typesafe.ai/settings/keys`)
  }

  const server = createServer()
  await server.connect(new StdioServerTransport())
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
