/**
 * redactSecrets() against the blind corpus in packages/core/test/blind-redact/: lines written by a
 * separate agent that never saw redact.ts or its tests (see the README there).
 *
 *   node --experimental-strip-types scripts/redact-blind.ts dev             # the working tree
 *   node --experimental-strip-types scripts/redact-blind.ts dev d55aa18     # redact.ts at any commit
 *   node --experimental-strip-types scripts/redact-blind.ts dev --show      # and list every miss
 *   node --experimental-strip-types scripts/redact-blind.ts holdout         # rates only, never lines
 *
 * The measures (fixed before anything was measured) are in packages/core/test/blindCorpus.ts. The
 * holdout half prints rates only: it's measured once, at the end, and not looked at to tune.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { leakOf as leaked, loadBlindHalf, type BlindItem as Item } from '../packages/core/test/blindCorpus.ts'

const args = process.argv.slice(2)
const half = args[0]
if (half !== 'dev' && half !== 'holdout') throw new Error('usage: redact-blind.ts dev|holdout [<git ref>] [--show]')
const show = args.includes('--show')
if (show && half === 'holdout') throw new Error('--show lists lines; the holdout half is measured for rates only')
const ref = args.slice(1).find((a) => a !== '--show')

let modulePath = new URL('../packages/core/src/redact.ts', import.meta.url).href
if (ref) {
  const file = join(mkdtempSync(join(tmpdir(), 'ctxjev-redact-')), 'redact.ts')
  writeFileSync(file, execFileSync('git', ['show', `${ref}:packages/core/src/redact.ts`], { encoding: 'utf8' }))
  modulePath = pathToFileURL(file).href
}
const { redactSecrets } = (await import(modulePath)) as { redactSecrets: (text: string) => string }

const items: Item[] = loadBlindHalf(half)

const secretItems = items.filter((i) => i.kind === 'secret')
const benignItems = items.filter((i) => i.kind === 'benign')
const missed: Array<{ item: Item; output: string; verbatim: boolean }> = []
let verbatimLeaks = 0
let secretsTotal = 0
let secretsLeaked = 0
for (const item of secretItems) {
  const output = redactSecrets(item.text)
  const result = leaked(item, output)
  if (result.strict) missed.push({ item, output, verbatim: result.verbatim })
  if (result.verbatim) verbatimLeaks++
  for (const secret of item.secrets) {
    secretsTotal++
    if (leaked({ ...item, secrets: [secret] }, output).strict) secretsLeaked++
  }
}
const altered = benignItems.map((item) => ({ item, output: redactSecrets(item.text) })).filter(({ item, output }) => output !== item.text)

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`
const detected = secretItems.length - missed.length
console.log(`${half} half, redact.ts at ${ref ?? 'the working tree'}:`)
console.log(`  lines with secrets detected: ${detected}/${secretItems.length} (${pct(detected, secretItems.length)}); none left whole (verbatim): ${secretItems.length - verbatimLeaks}/${secretItems.length} (${pct(secretItems.length - verbatimLeaks, secretItems.length)})`)
console.log(`  secrets masked: ${secretsTotal - secretsLeaked}/${secretsTotal} (${pct(secretsTotal - secretsLeaked, secretsTotal)})`)
console.log(`  harmless lines changed (false positives): ${altered.length}/${benignItems.length} (${pct(altered.length, benignItems.length)})`)
if (show) {
  for (const { item, output, verbatim } of missed) console.log(`\nMISSED ${item.id} [${item.context}] ${item.note}${verbatim ? '' : ' (partly)'}\n  in:  ${item.text}\n  out: ${output}`)
  for (const { item, output } of altered) console.log(`\nALTERED ${item.id} [${item.context}] ${item.note}\n  in:  ${item.text}\n  out: ${output}`)
}
