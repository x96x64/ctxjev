import { createHash } from 'node:crypto'
import type { Entry } from './types.js'

/**
 * A cache for entry-level relevance scores, keyed by `cacheKeyFor()`. The caller decides where it
 * lives (see `ScoreEntriesOptions.cache`): a file for the CLI, memory for the MCP server.
 */
export type ScoreCache = {
  get(key: string): number | undefined
  set(key: string, value: number): void
}

// Bump whenever what Jev is asked changes, so scores cached under the old question aren't reused.
const CACHE_KEY_VERSION = 3

type KeyedEntry = Pick<Entry, 'role' | 'toolName' | 'content'>

/**
 * A key for one entry's relevance under one goal, given the batch's latest activity. `latest` is
 * part of the key because it changes the answer: an old test failure is relevant until a later run
 * shows it fixed. A growing live history therefore misses more often; a Jev request costs far less
 * than acting on a stale verdict.
 *
 * The key is a SHA-256 digest (64 hex characters), not the goal and content themselves: keys end up
 * on disk (ctxjev-cli's score cache), and content in ctxjev's own transcript format isn't masked.
 */
export function cacheKeyFor(goal: string, entry: KeyedEntry, latest: KeyedEntry[] = []): string {
  const latestDigest = createHash('sha256')
    .update(JSON.stringify(latest.map((e) => [e.role, e.toolName ?? '', e.content])))
    .digest('hex')
    .slice(0, 16)
  // JSON.stringify, not a delimited join, so one field's content can't shift into another's.
  return createHash('sha256')
    .update(JSON.stringify([CACHE_KEY_VERSION, goal, entry.role, entry.toolName ?? '', entry.content, latestDigest]))
    .digest('hex')
}
