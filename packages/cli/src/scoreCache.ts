import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ScoreCache } from 'ctxjev-core'

export const DEFAULT_CACHE_PATH = join(homedir(), '.cache', 'ctxjev', 'score-cache.json')

/**
 * A `ScoreCache` backed by a single JSON file (`~/.cache/ctxjev/score-cache.json` by default),
 * shared across every `ctxjev analyze` run. Jev is probabilistic — re-scoring the exact same
 * content against the exact same goal costs real money for an answer that's already been seen,
 * which is exactly what happened repeatedly while demoing this CLI against the same sample
 * transcripts. Grows unbounded (no eviction) — fine for a personal cache of judgments, not meant
 * as a general key-value store.
 */
export async function loadFileScoreCache(path: string = DEFAULT_CACHE_PATH): Promise<{ cache: ScoreCache; save: () => Promise<void> }> {
  const store = new Map<string, number>(await readCacheFile(path))
  let dirty = false

  const cache: ScoreCache = {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value)
      dirty = true
    },
  }

  const save = async () => {
    if (!dirty) return
    await mkdir(dirname(path), { recursive: true })
    // Temp file + rename, not a plain writeFile — this file is shared across every `ctxjev
    // analyze` run, and a plain write can interleave with a concurrent run and corrupt it (the
    // same race packages/claude-plugin/src/preserve.ts's identical cache is guarded against).
    const tempPath = `${path}.${randomUUID()}.tmp`
    await writeFile(tempPath, JSON.stringify(Object.fromEntries(store)), 'utf8')
    await rename(tempPath, path)
  }

  return { cache, save }
}

async function readCacheFile(path: string): Promise<Array<[string, number]>> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'))
    return Object.entries(raw)
  } catch {
    return []
  }
}
