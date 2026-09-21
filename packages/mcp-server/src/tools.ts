import { DEFAULT_POLICY, createUsageAccumulator, pruneContext, scoreEntries, summarizeSavings, type Entry, type PruningPolicy, type ScoreCache } from 'ctxjev-core'
import { validatePolicyOrdering } from './schemas.js'

/**
 * Plain functions wrapping ctxjev-core, kept independent of the MCP framework so they're
 * testable without spinning up a server. src/server.ts adapts these into MCP tool handlers.
 */

// A long-lived server process gets called repeatedly with overlapping history as an agent's
// transcript grows — this in-memory cache (module-level, shared across calls, but never
// persisted) means the second call over the same content doesn't re-pay Jev for it. Unbounded,
// like the CLI's own file-backed cache — fine for one server process's lifetime.
const scoreCache: ScoreCache = (() => {
  const store = new Map<string, number>()
  return { get: (key) => store.get(key), set: (key, value) => store.set(key, value) }
})()

export type ScoreRelevanceArgs = {
  goal: string
  entries: Entry[]
  recencyWeight?: number
}

export async function scoreRelevanceTool({ goal, entries, recencyWeight }: ScoreRelevanceArgs) {
  const { usage, onUsage } = createUsageAccumulator()
  const scored = await scoreEntries(entries, goal, recencyWeight ?? DEFAULT_POLICY.recencyWeight, { onUsage, cache: scoreCache })
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
  validatePolicyOrdering(policy.dropBelow, policy.summarizeBelow)

  const { usage, onUsage } = createUsageAccumulator()
  const decisions = await pruneContext(entries, goal, policy, { onUsage, cache: scoreCache })
  const savings = summarizeSavings(entries, decisions)
  return { decisions, savings, usage }
}
