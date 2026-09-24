import { DEFAULT_POLICY, createUsageAccumulator, pruneContext, scoreEntries, summarizeSavings, type Entry, type PruningPolicy, type ScoreCache } from 'ctxjev-core'
import { validatePolicyOrdering } from './schemas.js'

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

export type ScoreRelevanceArgs = {
  goal: string
  entries: Entry[]
  recencyWeight?: number
}

export async function scoreRelevanceTool({ goal, entries, recencyWeight }: ScoreRelevanceArgs) {
  const { usage, onUsage } = createUsageAccumulator()
  // core's own default scorer is 'recency' as of 0.6.0 (see prune.ts), since the holdout eval tied
  // Jev on task success. This tool's whole purpose is exposing Jev scoring, so it keeps asking for
  // it explicitly rather than silently inheriting that default.
  const scored = await scoreEntries(entries, goal, recencyWeight ?? DEFAULT_POLICY.recencyWeight, { onUsage, cache: scoreCache, scorer: 'jev' })
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
  const decisions = await pruneContext(entries, goal, policy, { onUsage, cache: scoreCache, scorer: 'jev' })
  const savings = summarizeSavings(entries, decisions)
  return { decisions, savings, usage }
}
