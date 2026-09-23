import type { Entry } from './types.js'

/** Splits entries into one Jev request's worth each. 50 is a conservative per-request ceiling. */
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
