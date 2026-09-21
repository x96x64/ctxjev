import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ScoredEntry } from 'ctxjev-core'

export type PreservedContext = {
  goal: string
  scoredAt: string
  entries: Array<ScoredEntry & { content: string }>
}

function cachePath(cwd: string): string {
  return join(cwd, '.ctxjev', 'preserved-context.json')
}

export async function writePreservedContext(cwd: string, data: PreservedContext): Promise<void> {
  await mkdir(join(cwd, '.ctxjev'), { recursive: true })
  // Write to a temp file and rename over the real path — a plain writeFile can interleave with
  // another concurrent PreCompact run on the same project (two sessions on the same repo) and
  // corrupt the JSON; rename is atomic on the same filesystem.
  const finalPath = cachePath(cwd)
  const tempPath = `${finalPath}.${randomUUID()}.tmp`
  await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8')
  await rename(tempPath, finalPath)
}

export async function readPreservedContext(cwd: string): Promise<PreservedContext | undefined> {
  try {
    return JSON.parse(await readFile(cachePath(cwd), 'utf8'))
  } catch {
    return undefined
  }
}

/** preCompact.ts has several early-return paths (no API key, no entries, no goal, nothing
 * selected) that skip writing a fresh snapshot — call this before any of them so a stale
 * snapshot from an earlier, unrelated compaction never lingers for sessionStartCompact.ts to
 * re-inject as if it reflects the compaction that just happened. */
export async function clearPreservedContext(cwd: string): Promise<void> {
  await rm(cachePath(cwd), { force: true })
}
