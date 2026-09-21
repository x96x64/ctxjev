import type { Entry } from './types.js'

/**
 * Normalizes each entry's timestamp to 0-1 *within this batch* (oldest → 0, newest → 1) —
 * not against wall-clock "now". A live agent's history and a transcript replayed long after
 * the fact should score recency the same way; anchoring to `Date.now()` would make every
 * entry in a replayed transcript read as maximally stale regardless of its actual position
 * in the conversation.
 */
export function computeRecency(entries: Entry[]): Map<string, number> {
  if (entries.length === 0) return new Map()

  // A reduce, not Math.min(...timestamps)/Math.max(...timestamps) — spreading a very large
  // entry list as call arguments risks a stack-size RangeError, and this runs on the whole
  // unchunked batch.
  let min = entries[0].timestamp
  let max = entries[0].timestamp
  for (const { timestamp } of entries) {
    if (timestamp < min) min = timestamp
    if (timestamp > max) max = timestamp
  }
  const range = max - min

  // All entries share one timestamp (or there's only one entry) — no ordering information
  // to extract, so don't penalize any of them for "staleness" that isn't actually known.
  if (range === 0) {
    return new Map(entries.map((e) => [e.id, 1]))
  }

  return new Map(entries.map((e) => [e.id, (e.timestamp - min) / range]))
}
