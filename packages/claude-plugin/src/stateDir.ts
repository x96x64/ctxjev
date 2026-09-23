import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * `.ctxjev/` in the user's project, created with a `.gitignore` of `*` inside it: the cache holds
 * transcript excerpts, which must never end up committed to someone's repo by accident.
 */
export async function ensureStateDir(cwd: string): Promise<string> {
  const dir = join(cwd, '.ctxjev')
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(join(dir, '.gitignore'), '*\n', { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
  return dir
}
