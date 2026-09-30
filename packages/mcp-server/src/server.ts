import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { pruneHistoryInput, scoreRelevanceInput } from './schemas.js'
import { pruneHistoryTool, scoreRelevanceTool } from './tools.js'

// Read from this package's own package.json rather than a hardcoded constant, so the version
// reported to MCP clients can't silently go stale after the next release the way a literal
// string would (ctxjev-cli's --version had exactly this bug — see CHANGELOG 0.1.2).
const VERSION: string = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
).version

const MISSING_KEY = {
  isError: true,
  content: [
    {
      type: 'text' as const,
      text: 'TYPESAFE_API_KEY is not set in the environment this MCP server runs in. scorer "jev" (the default) needs it: get one at console.typesafe.ai/settings/keys and add it to the server\'s env in your MCP host\'s config, or pass scorer "local" (keyword overlap) or "recency" (plain truncation), which run offline.',
    },
  ],
}

// Checked per call, not at startup, so a server started without a key still connects and lists its
// tools; and only for scorer 'jev', since 'local' and 'recency' need no key.
const needsMissingKey = (scorer: string) => scorer === 'jev' && !process.env.TYPESAFE_API_KEY

export function createServer(): McpServer {
  const server = new McpServer({ name: 'ctxjev', version: VERSION })

  server.registerTool(
    'score_relevance',
    {
      description:
        "Score a batch of AI agent history entries for relevance to a goal: with Jev by default (needs TYPESAFE_API_KEY), or offline with scorer 'local' or 'recency'. Doesn't decide what to do about it — see prune_history for that.",
      inputSchema: scoreRelevanceInput,
    },
    async (args) => {
      if (needsMissingKey(args.scorer)) return MISSING_KEY
      const result = await scoreRelevanceTool(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.registerTool(
    'prune_history',
    {
      description: "Score a batch of AI agent history entries against a goal and decide what to keep, drop, or summarize: with Jev by default (needs TYPESAFE_API_KEY), or offline with scorer 'local' or 'recency'.",
      inputSchema: pruneHistoryInput,
    },
    async (args) => {
      if (needsMissingKey(args.scorer)) return MISSING_KEY
      const result = await pruneHistoryTool(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  return server
}
