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
      text: 'TYPESAFE_API_KEY is not set in the environment this MCP server runs in. Both tools score with Jev and need it: get one at console.typesafe.ai/settings/keys and add it to the server\'s env in your MCP host\'s config.',
    },
  ],
}

// Checked per call, not at startup, so a server started without a key still connects and lists its tools.
const hasKey = () => Boolean(process.env.TYPESAFE_API_KEY)

export function createServer(): McpServer {
  const server = new McpServer({ name: 'ctxjev', version: VERSION })

  server.registerTool(
    'score_relevance',
    {
      description:
        "Score a batch of AI agent history entries for relevance to a goal, using Jev. Doesn't decide what to do about it — see prune_history for that.",
      inputSchema: scoreRelevanceInput,
    },
    async (args) => {
      if (!hasKey()) return MISSING_KEY
      const result = await scoreRelevanceTool(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.registerTool(
    'prune_history',
    {
      description: 'Score a batch of AI agent history entries against a goal and decide what to keep, drop, or summarize.',
      inputSchema: pruneHistoryInput,
    },
    async (args) => {
      if (!hasKey()) return MISSING_KEY
      const result = await pruneHistoryTool(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  return server
}
