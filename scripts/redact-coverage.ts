/**
 * How many of the secret formats in packages/core/test/redactCases.ts a version of redactSecrets()
 * masks, and how many of the harmless strings it wrongly changes.
 *
 *   node --experimental-strip-types scripts/redact-coverage.ts              # the working tree
 *   node --experimental-strip-types scripts/redact-coverage.ts 2cf4eba      # redact.ts at any commit
 *
 * Needs Node 22 (type stripping). The cases are the current ones, whichever redact.ts is measured.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FORMATS, HARMLESS } from '../packages/core/test/redactCases.ts'

const ref = process.argv[2]
let modulePath = new URL('../packages/core/src/redact.ts', import.meta.url).href
if (ref) {
  const file = join(mkdtempSync(join(tmpdir(), 'ctxjev-redact-')), 'redact.ts')
  writeFileSync(file, execFileSync('git', ['show', `${ref}:packages/core/src/redact.ts`], { encoding: 'utf8' }))
  modulePath = pathToFileURL(file).href
}
const { redactSecrets } = (await import(modulePath)) as { redactSecrets: (text: string) => string }

const missed = FORMATS.filter((f) => redactSecrets(f.text).includes(f.secret))
const altered = HARMLESS.filter((text) => redactSecrets(text) !== text)
console.log(`${ref ?? 'working tree'}: ${FORMATS.length - missed.length}/${FORMATS.length} formats masked, ${altered.length}/${HARMLESS.length} harmless strings altered`)
for (const f of missed) console.log(`  missed:  ${f.name}`)
for (const text of altered) console.log(`  altered: ${text}`)
