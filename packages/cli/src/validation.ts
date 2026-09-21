import { isValidPolicyOrdering } from 'ctxjev-core'

/** Rejects anything that isn't a real number in [0, 1] instead of silently becoming NaN — a NaN
 * threshold compares false against every score, so `decideAction` would quietly never "drop". */
export function parseThreshold(raw: string): number | undefined {
  if (raw.trim().length === 0) return undefined // Number('') is 0, not NaN — reject it explicitly
  const n = Number(raw)
  if (Number.isNaN(n) || n < 0 || n > 1) return undefined
  return n
}

/** Nothing about parsing each threshold independently catches a reversed pair, which would
 * silently make "summarize" unreachable — check the resolved pair together. The invariant itself
 * lives in ctxjev-core; this just formats the CLI's own flag names into the error. */
export function describePolicyOrderingError(dropBelow: number, summarizeBelow: number): string | undefined {
  if (!isValidPolicyOrdering(dropBelow, summarizeBelow)) {
    return `--drop-below (${dropBelow}) must not be greater than --summarize-below (${summarizeBelow})`
  }
  return undefined
}
