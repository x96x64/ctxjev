import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { pruneHistoryInput, scoreRelevanceInput } from './schemas.js'
import { pruneHistoryTool, scoreRelevanceTool } from './tools.js'

export function createServer(): McpServer {
  const server = new McpServer({ name: 'ctxjev', version: '0.0.0' })

  server.registerTool(
    'score_relevance',
    {
      description:
        "Score a batch of AI agent history entries for relevance to a goal, using Jev. Doesn't decide what to do about it — see prune_history for that.",
      inputSchema: scoreRelevanceInput,
    },
    async (args) => {
      const scored = await scoreRelevanceTool(args)
      return { content: [{ type: 'text', text: JSON.stringify(scored, null, 2) }] }
    },
  )

  server.registerTool(
    'prune_history',
    {
      description: 'Score a batch of AI agent history entries against a goal and decide what to keep, drop, or summarize.',
      inputSchema: pruneHistoryInput,
    },
    async (args) => {
      const result = await pruneHistoryTool(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  return server
}
