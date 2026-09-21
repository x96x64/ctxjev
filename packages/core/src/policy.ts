import type { PruneAction, PruningPolicy } from './types.js'

export function combineScore(relevance: number, recency: number, recencyWeight: number): number {
  return relevance * (1 - recencyWeight) + recency * recencyWeight
}

export function decideAction(score: number, policy: PruningPolicy): PruneAction {
  // NaN compares false against every threshold below, which would otherwise fall through to
  // 'keep' by default — silently treating "we don't know" as "definitely keep this".
  if (Number.isNaN(score)) {
    throw new Error('decideAction received a NaN score — check for a bad relevance/recency input upstream')
  }
  if (score < policy.dropBelow) return 'drop'
  if (score < policy.summarizeBelow) return 'summarize'
  return 'keep'
}
