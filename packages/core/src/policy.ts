import type { PruneAction, PruningPolicy } from './types.js'

export function combineScore(relevance: number, recency: number, recencyWeight: number): number {
  return relevance * (1 - recencyWeight) + recency * recencyWeight
}

export function decideAction(score: number, policy: PruningPolicy): PruneAction {
  if (score < policy.dropBelow) return 'drop'
  if (score < policy.summarizeBelow) return 'summarize'
  return 'keep'
}
