import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { missingTypesafeApiKey } from 'ctxjev-core'
import { pruneHistorySchema, scoreRelevanceSchema } from './schemas.js'
import { pruneHistoryTool, scoreRelevanceTool } from './tools.js'

// Read from this package's own package.json rather than a hardcoded constant, so the version
// reported to MCP clients can't silently go stale after the next release the way a literal
// string would (ctxjev-cli's --version had exactly this bug — see CHANGELOG 0.1.2).
const VERSION: string = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
).version

const missingKeyResult = (missing: string) => ({
  isError: true,
  content: [
    {
      type: 'text' as const,
      text: `${missing} in the environment this MCP server runs in. scorer "jev" (the default) needs a key: get one at console.typesafe.ai/settings/keys and add it to the server's env in your MCP host's config, or pass scorer "local" (keyword overlap) or "recency" (plain truncation), which run offline.`,
    },
  ],
})

// Checked per call, not at startup, so a server started without a key still connects and lists its
// tools; and only for scorer 'jev', since 'local' and 'recency' need no key. An unexpanded
// placeholder (Codex passes `${TYPESAFE_API_KEY}` through as it is) counts as no key.
const missingKeyFor = (scorer: string) => (scorer === 'jev' ? missingTypesafeApiKey() : undefined)

export function createServer(): McpServer {
  const server = new McpServer({ name: 'ctxjev', version: VERSION })

  server.registerTool(
    'score_relevance',
    {
      description:
        "Score a batch of AI agent history entries for relevance to a goal: with Jev by default (needs TYPESAFE_API_KEY), or offline with scorer 'local' or 'recency'. Under 'local', relevance is keyword overlap ranked within the batch (0 lowest, 1 highest; `tied` when every entry overlaps equally), the scale prune_history's thresholds use. Doesn't decide what to do about it — see prune_history for that.",
      inputSchema: scoreRelevanceSchema,
    },
    async (args) => {
      const missing = missingKeyFor(args.scorer)
      if (missing !== undefined) return missingKeyResult(missing)
      const result = await scoreRelevanceTool(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.registerTool(
    'prune_history',
    {
      description: "Score a batch of AI agent history entries against a goal and decide what to keep, drop, or summarize: with Jev by default (needs TYPESAFE_API_KEY), or offline with scorer 'local' or 'recency'.",
      inputSchema: pruneHistorySchema,
    },
    async (args) => {
      const missing = missingKeyFor(args.scorer)
      if (missing !== undefined) return missingKeyResult(missing)
      const result = await pruneHistoryTool(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  return server
}
