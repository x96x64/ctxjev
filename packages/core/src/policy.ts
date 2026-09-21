import type { PruneAction, PruningPolicy } from './types.js'

export function decideAction(relevance: number, policy: PruningPolicy): PruneAction {
  if (relevance < policy.dropBelow) return 'drop'
  if (relevance < policy.summarizeBelow) return 'summarize'
  return 'keep'
}
