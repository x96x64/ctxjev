import { randomUUID } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'

/**
 * Writes to a temp file next to `path`, then renames it over the real path — atomic on the same
 * filesystem, so a concurrent writer to the same path can't interleave with this one and corrupt
 * it. Shared by `ctxjev-cli`'s score cache and `ctxjev-claude`'s preserved-context cache, which
 * each write one JSON file that can be read and written by more than one process at a time.
 */
export async function atomicWriteFile(path: string, content: string, options: { mode?: number } = {}): Promise<void> {
  const tempPath = `${path}.${randomUUID()}.tmp`
  await writeFile(tempPath, content, { encoding: 'utf8', ...(options.mode !== undefined && { mode: options.mode }) })
  await rename(tempPath, path)
}
