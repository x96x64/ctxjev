import type { Entry } from './types.js'

/**
 * A cache for entry-level relevance scores, keyed by `cacheKeyFor()`. Injected by the caller
 * (see `ScoreEntriesOptions.cache`) rather than owned here, so `ctxjev-core` stays host-agnostic
 * about *where* results are persisted — a CLI might back this with a file, an MCP server might
 * not use one at all.
 */
export type ScoreCache = {
  get(key: string): number | undefined
  set(key: string, value: number): void
}

/**
 * A deterministic key for one entry's relevance under one goal, built from the exact fields
 * Jev's judgment actually depends on — a collision here would silently return the wrong cached
 * score, and these strings are only ever used as a lookup key, never displayed or stored
 * space-efficiently on their own.
 */
// Bump whenever what Jev is asked changes, so scores cached under the old question aren't reused.
// (The batch-wide `latest` context isn't part of the key: it would make every live-agent lookup a miss.)
const CACHE_KEY_VERSION = 2

export function cacheKeyFor(goal: string, entry: Pick<Entry, 'role' | 'toolName' | 'content'>): string {
  // JSON.stringify, not a delimited join — a join lets a field's own content shift the
  // delimiter boundary and collide with a different (role, toolName, content) tuple.
  return JSON.stringify([CACHE_KEY_VERSION, goal, entry.role, entry.toolName ?? '', entry.content])
}
