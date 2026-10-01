/**
 * redactSecrets() against a blind corpus in packages/core/test/: lines written by a separate agent
 * that never saw redact.ts or its tests (see the README in each). `--corpus 2` picks Round 4's
 * (test/blind-redact-2/), `--corpus 3` Round 5's (test/blind-redact-3/); the default is Round 3's
 * (test/blind-redact/). The first two holdout halves are used up.
 *
 *   node --experimental-strip-types scripts/redact-blind.ts dev             # the working tree
 *   node --experimental-strip-types scripts/redact-blind.ts dev d55aa18     # redact.ts at any commit
 *   node --experimental-strip-types scripts/redact-blind.ts dev --show      # and list every miss
 *   node --experimental-strip-types scripts/redact-blind.ts holdout         # rates only, never lines
 *   node --experimental-strip-types scripts/redact-blind.ts dev --corpus 2  # Round 4's corpus
 *   node --experimental-strip-types scripts/redact-blind.ts dev --corpus 3  # Round 5's corpus
 *
 * The measures (fixed before anything was measured) are in packages/core/test/blindCorpus.ts. The
 * holdout half prints rates only: it's measured once, at the end, and not looked at to tune.
 */
import { loadRedactSecrets } from './loadRedact.ts'
import { leakOf as leaked, loadBlindHalf, type BlindItem as Item } from '../packages/core/test/blindCorpus.ts'

const args = process.argv.slice(2)
const half = args[0]
if (half !== 'dev' && half !== 'holdout') throw new Error('usage: redact-blind.ts dev|holdout [<git ref>] [--show]')
const show = args.includes('--show')
if (show && half === 'holdout') throw new Error('--show lists lines; the holdout half is measured for rates only')
const corpusAt = args.indexOf('--corpus')
const corpusArg = corpusAt === -1 ? undefined : args[corpusAt + 1]
if (corpusAt !== -1 && corpusArg !== '1' && corpusArg !== '2' && corpusArg !== '3') throw new Error('--corpus takes 1 (Round 3), 2 (Round 4), or 3 (Round 5)')
const corpus = corpusArg === '3' ? 'blind-redact-3' : corpusArg === '2' ? 'blind-redact-2' : 'blind-redact'
const ref = args.slice(1).find((a, i, rest) => a !== '--show' && a !== '--corpus' && rest[i - 1] !== '--corpus')

const redactSecrets = await loadRedactSecrets(ref)

const items: Item[] = loadBlindHalf(half, corpus)

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
console.log(`${corpus} ${half} half, redact.ts at ${ref ?? 'the working tree'}:`)
console.log(`  lines with secrets detected: ${detected}/${secretItems.length} (${pct(detected, secretItems.length)}); none left whole (verbatim): ${secretItems.length - verbatimLeaks}/${secretItems.length} (${pct(secretItems.length - verbatimLeaks, secretItems.length)})`)
console.log(`  secrets masked: ${secretsTotal - secretsLeaked}/${secretsTotal} (${pct(secretsTotal - secretsLeaked, secretsTotal)})`)
console.log(`  harmless lines changed (false positives): ${altered.length}/${benignItems.length} (${pct(altered.length, benignItems.length)})`)
if (show) {
  for (const { item, output, verbatim } of missed) console.log(`\nMISSED ${item.id} [${item.context}] ${item.note}${verbatim ? '' : ' (partly)'}\n  in:  ${item.text}\n  out: ${output}`)
  for (const { item, output } of altered) console.log(`\nALTERED ${item.id} [${item.context}] ${item.note}\n  in:  ${item.text}\n  out: ${output}`)
}
