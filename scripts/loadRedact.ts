/**
 * redactSecrets() from the working tree or from any commit, for the measuring scripts
 * (redact-blind.ts, redact-coverage.ts). redact.ts and the files it imports (redactLegacy.ts and
 * validate.ts, both from 0.7.0) are copied to a temporary directory, with the imports pointed at the
 * .ts files so Node can load them; validate.ts's own imports are type-only, which Node strips.
 * Needs Node 22 (type stripping).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const FILES = ['redact.ts', 'redactLegacy.ts', 'validate.ts']

export async function loadRedactSecrets(ref?: string): Promise<(text: string) => string> {
  const dir = mkdtempSync(join(tmpdir(), 'ctxjev-redact-'))
  for (const name of FILES) {
    let source: string
    try {
      source = ref
        ? execFileSync('git', ['show', `${ref}:packages/core/src/${name}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        : readFileSync(new URL(`../packages/core/src/${name}`, import.meta.url), 'utf8')
    } catch {
      continue // not in this commit (redactLegacy.ts and validate.ts are new in 0.7.0)
    }
    writeFileSync(join(dir, name), source.replace(/from '\.\/(redactLegacy|validate)\.js'/g, "from './$1.ts'"))
  }
  const { redactSecrets } = (await import(pathToFileURL(join(dir, 'redact.ts')).href)) as { redactSecrets: (text: string) => string }
  return redactSecrets
}
