import { chmod, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { atomicWriteFile, type ScoreCache } from 'ctxjev-core'

export const DEFAULT_CACHE_PATH = join(homedir(), '.cache', 'ctxjev', 'score-cache.json')

/** Enough for a few hundred analyzed transcripts; about 80 bytes each on disk. */
export const DEFAULT_MAX_ENTRIES = 20_000

/**
 * A `ScoreCache` backed by a single JSON file (`~/.cache/ctxjev/score-cache.json` by default),
 * shared across every `ctxjev analyze --scorer jev` run. Jev is probabilistic — re-scoring the exact
 * same content against the exact same goal costs real money for an answer that's already been seen,
 * which is exactly what happened repeatedly while demoing this CLI against the same sample
 * transcripts.
 *
 * Keys are digests (see `cacheKeyFor`), so the file holds no goal or transcript text; it's written
 * readable only by the user (0600, in a 0700 directory) and keeps the `maxEntries` most recently
 * used scores. Plain-text keys an earlier version wrote are dropped on load, and the file rewritten.
 */
export async function loadFileScoreCache(
  path: string = DEFAULT_CACHE_PATH,
  { maxEntries = DEFAULT_MAX_ENTRIES }: { maxEntries?: number } = {},
): Promise<{ cache: ScoreCache; save: () => Promise<void> }> {
  const loaded = await readCacheFile(path)
  // Up to 0.5.x, a key was the JSON array [version, goal, role, toolName, content, digest] itself.
  const current = loaded.filter(([key]) => !key.startsWith('['))
  const store = new Map<string, number>(current)
  let dirty = current.length < loaded.length

  const cache: ScoreCache = {
    get: (key) => {
      const value = store.get(key)
      if (value !== undefined) {
        store.delete(key)
        store.set(key, value)
      }
      return value
    },
    set: (key, value) => {
      store.delete(key)
      store.set(key, value)
      dirty = true
    },
  }

  const save = async () => {
    if (!dirty) return
    // Map order is least recently used first, so the oldest go.
    for (const key of store.keys()) {
      if (store.size <= maxEntries) break
      store.delete(key)
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    // mkdir's mode only applies to a directory it creates; one an earlier version made is 0755.
    await chmod(dirname(path), 0o700)
    // Atomic write — this file is shared across every `ctxjev analyze` run, and a plain write
    // can interleave with a concurrent run and corrupt it (the same race
    // packages/claude-plugin/src/preserve.ts's identical cache is guarded against).
    await atomicWriteFile(path, JSON.stringify(Object.fromEntries(store)), { mode: 0o600 })
  }

  return { cache, save }
}

async function readCacheFile(path: string): Promise<Array<[string, number]>> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'))
    return Object.entries(raw).filter((e): e is [string, number] => typeof e[1] === 'number')
  } catch {
    return []
  }
}
