import type { PruneAction, PruningPolicy } from './types.js'

export function combineScore(relevance: number, recency: number, recencyWeight: number): number {
  return relevance * (1 - recencyWeight) + recency * recencyWeight
}

/** `decideAction`'s sequential `<` comparisons silently make 'summarize' unreachable if the pair
 * is reversed — every caller that accepts these two independently (a CLI flag pair, an MCP
 * schema) must check this once, resolved, instead of trusting each value's own [0,1] range. */
export function isValidPolicyOrdering(dropBelow: number, summarizeBelow: number): boolean {
  return dropBelow <= summarizeBelow
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
