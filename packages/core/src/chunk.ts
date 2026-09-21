import type { Entry } from './types.js'

/**
 * Jev evaluates many parallel questions against one shared state in a single request
 * (the "speculative fan-out" pattern) — cost barely grows with question count, but each
 * request still has a practical ceiling. maxPerRequest defaults conservatively; raise it
 * once real request/response sizes against the live API are known.
 */
export function chunkEntries(entries: Entry[], maxPerRequest = 50): Entry[][] {
  if (!Number.isFinite(maxPerRequest) || maxPerRequest <= 0) {
    throw new Error(`maxPerRequest must be a positive number, got ${maxPerRequest}`)
  }

  const chunks: Entry[][] = []
  for (let i = 0; i < entries.length; i += maxPerRequest) {
    chunks.push(entries.slice(i, i + maxPerRequest))
  }
  return chunks
}
