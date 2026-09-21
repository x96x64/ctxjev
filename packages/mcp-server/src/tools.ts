import { DEFAULT_POLICY, createUsageAccumulator, pruneContext, scoreEntries, summarizeSavings, type Entry, type PruningPolicy } from 'ctxjev-core'

/**
 * Plain functions wrapping ctxjev-core, kept independent of the MCP framework so they're
 * testable without spinning up a server. src/server.ts adapts these into MCP tool handlers.
 */

export type ScoreRelevanceArgs = {
  goal: string
  entries: Entry[]
  recencyWeight?: number
}

export async function scoreRelevanceTool({ goal, entries, recencyWeight }: ScoreRelevanceArgs) {
  const { usage, onUsage } = createUsageAccumulator()
  const scored = await scoreEntries(entries, goal, recencyWeight ?? DEFAULT_POLICY.recencyWeight, { onUsage })
  return { scored, usage }
}

export type PruneHistoryArgs = ScoreRelevanceArgs & {
  dropBelow?: number
  summarizeBelow?: number
}

export async function pruneHistoryTool({ goal, entries, recencyWeight, dropBelow, summarizeBelow }: PruneHistoryArgs) {
  const policy: PruningPolicy = {
    dropBelow: dropBelow ?? DEFAULT_POLICY.dropBelow,
    summarizeBelow: summarizeBelow ?? DEFAULT_POLICY.summarizeBelow,
    recencyWeight: recencyWeight ?? DEFAULT_POLICY.recencyWeight,
  }

  const { usage, onUsage } = createUsageAccumulator()
  const decisions = await pruneContext(entries, goal, policy, { onUsage })
  const savings = summarizeSavings(entries, decisions)
  return { decisions, savings, usage }
}
