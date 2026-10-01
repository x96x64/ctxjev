import { DEFAULT_POLICY, pruneContext, scoreEntries, summarizeSavings, type Entry, type JevClient, type PruningPolicy, type ScoreCache } from 'ctxjev-core'
import { createUsageAccumulator, rankLocalRelevance } from 'ctxjev-core/internal'
import { validatePolicyOrdering, type McpScorer } from './schemas.js'

/**
 * Plain functions wrapping ctxjev-core, kept independent of the MCP framework so they're
 * testable without spinning up a server. src/server.ts adapts these into MCP tool handlers.
 */

// Shared across calls, so re-scoring overlapping history doesn't re-pay Jev for it. Bounded,
// since a server can run for as long as its host does: the least recently used key goes first.
export const SCORE_CACHE_LIMIT = 5_000

export function createBoundedScoreCache(limit = SCORE_CACHE_LIMIT): ScoreCache & { readonly size: number } {
  const store = new Map<string, number>()
  return {
    get(key) {
      const value = store.get(key)
      if (value !== undefined) {
        store.delete(key)
        store.set(key, value)
      }
      return value
    },
    set(key, value) {
      store.delete(key)
      store.set(key, value)
      if (store.size > limit) store.delete(store.keys().next().value!)
    },
    get size() {
      return store.size
    },
  }
}

const scoreCache = createBoundedScoreCache()

/** What a tool talks to: the server's shared cache and the default Jev client, unless a test passes its own. */
export type ToolDeps = { jevClient?: JevClient; cache?: ScoreCache }

export type ScoreRelevanceArgs = {
  /** Defaults to 'jev', as in 0.7.0; 'local' and 'recency' run offline. */
  scorer?: McpScorer
  goal: string
  entries: Entry[]
  recencyWeight?: number
}

export async function scoreRelevanceTool({ scorer = 'local', goal, entries, recencyWeight }: ScoreRelevanceArgs, { jevClient, cache = scoreCache }: ToolDeps = {}) {
  const { usage, onUsage } = createUsageAccumulator()
  // Offline by default ('local', from 1.0), like the library, the CLI, and the plugin: only a call
  // that names 'jev' sends anything. 'local' rather than core's 'recency', since these tools score
  // relevance to a goal and 'recency' ignores it.
  const weight = recencyWeight ?? DEFAULT_POLICY.recencyWeight
  const scored = await scoreEntries(entries, goal, weight, { onUsage, cache, jevClient, scorer })
  // 'local' on the scale prune_history (pruneContext) acts on: overlap ranked within the batch, so an
  // entry scores the same in both tools. 0.7.1 returned the raw overlap here (the fifth audit).
  return { scored: scorer === 'local' ? rankLocalRelevance(scored, weight) : scored, usage }
}

export type PruneHistoryArgs = ScoreRelevanceArgs & {
  dropBelow?: number
  summarizeBelow?: number
}

export async function pruneHistoryTool({ scorer = 'local', goal, entries, recencyWeight, dropBelow, summarizeBelow }: PruneHistoryArgs, { jevClient, cache = scoreCache }: ToolDeps = {}) {
  const policy: PruningPolicy = {
    dropBelow: dropBelow ?? DEFAULT_POLICY.dropBelow,
    summarizeBelow: summarizeBelow ?? DEFAULT_POLICY.summarizeBelow,
    recencyWeight: recencyWeight ?? DEFAULT_POLICY.recencyWeight,
  }
  validatePolicyOrdering(policy.dropBelow, policy.summarizeBelow)

  const { usage, onUsage } = createUsageAccumulator()
  const decisions = await pruneContext(entries, goal, policy, { onUsage, cache, jevClient, scorer })
  const savings = summarizeSavings(entries, decisions)
  return { decisions, savings, usage }
}
