/**
 * Each value's percentile rank within `values`, from 0 (lowest) to 1 (highest), so scores on any
 * scale can be compared with `DEFAULT_POLICY`'s thresholds, which were tuned on probabilities.
 *
 * Tied values share a rank: `'mid'` (the default, chosen on the dev split by
 * eval/calibrate-local.mjs) gives a tie group its members' average rank, `'min'` its lowest
 * member's. A single value, or a batch where every value is equal, ranks 1: with nothing to rank
 * it below, there's no signal to drop it on.
 */
export type TieRank = 'min' | 'mid'

export function percentileRanks(values: number[], ties: TieRank = 'mid'): number[] {
  const n = values.length
  if (n === 0) return []
  const order = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value)
  const ranks = new Array<number>(n)
  if (order[0].value === order[n - 1].value) return ranks.fill(1)
  for (let start = 0; start < n; ) {
    let end = start
    while (end + 1 < n && order[end + 1].value === order[start].value) end++
    const rank = ties === 'min' ? start : (start + end) / 2
    for (let k = start; k <= end; k++) ranks[order[k].i] = rank / (n - 1)
    start = end + 1
  }
  return ranks
}
