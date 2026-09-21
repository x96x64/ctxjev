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

  const timestamps = entries.map((e) => e.timestamp)
  const min = Math.min(...timestamps)
  const max = Math.max(...timestamps)
  const range = max - min

  // All entries share one timestamp (or there's only one entry) — no ordering information
  // to extract, so don't penalize any of them for "staleness" that isn't actually known.
  if (range === 0) {
    return new Map(entries.map((e) => [e.id, 1]))
  }

  return new Map(entries.map((e) => [e.id, (e.timestamp - min) / range]))
}
