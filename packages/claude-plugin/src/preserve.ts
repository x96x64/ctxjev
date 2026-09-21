import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  await writeFile(cachePath(cwd), JSON.stringify(data, null, 2), 'utf8')
}

export async function readPreservedContext(cwd: string): Promise<PreservedContext | undefined> {
  try {
    return JSON.parse(await readFile(cachePath(cwd), 'utf8'))
  } catch {
    return undefined
  }
}
