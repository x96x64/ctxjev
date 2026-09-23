import type { Entry } from './types.js'

/**
 * Each entry's timestamp normalized to 0-1 within this batch (oldest 0, newest 1), not against
 * `Date.now()`, so a transcript replayed later scores the same as a live one.
 */
export function computeRecency(entries: Entry[]): Map<string, number> {
  if (entries.length === 0) return new Map()

  // A loop, not Math.min(...timestamps): spreading a huge batch as arguments can overflow the stack.
  let min = entries[0].timestamp
  let max = entries[0].timestamp
  for (const { timestamp } of entries) {
    if (timestamp < min) min = timestamp
    if (timestamp > max) max = timestamp
  }
  const range = max - min

  // No ordering to extract, so no entry is penalized for staleness.
  if (range === 0) {
    return new Map(entries.map((e) => [e.id, 1]))
  }

  return new Map(entries.map((e) => [e.id, (e.timestamp - min) / range]))
}
