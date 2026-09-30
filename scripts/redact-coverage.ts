/**
 * How many of the secret formats in packages/core/test/redactCases.ts a version of redactSecrets()
 * masks, and how many of the harmless strings it wrongly changes.
 *
 *   node --experimental-strip-types scripts/redact-coverage.ts              # the working tree
 *   node --experimental-strip-types scripts/redact-coverage.ts 2cf4eba      # redact.ts at any commit
 *
 * Needs Node 22 (type stripping). The cases are the current ones, whichever redact.ts is measured.
 * On the working tree it exits 1 if anything is missed or altered (CI runs it); on a commit it only
 * reports. It crashed in 0.7.0 (the fourth audit's P2-10): redact.ts had started importing
 * redactLegacy.ts, which it didn't copy (loadRedact.ts now does).
 */
import { AUDIT3_FORMATS, AUDIT4_HARMLESS, ENV_SWEEP, ENV_SWEEP_HALVES, FORMATS, HARMLESS } from '../packages/core/test/redactCases.ts'
import { loadRedactSecrets } from './loadRedact.ts'

const ref = process.argv[2]
const redactSecrets = await loadRedactSecrets(ref)

const formats = [...FORMATS, ...AUDIT3_FORMATS].map((f) => ({ name: f.name, text: f.text, secrets: [f.secret] }))
const sweep = ENV_SWEEP.map(({ text }) => ({ name: text, text, secrets: ENV_SWEEP_HALVES }))
const leaks = (cases: typeof formats) => cases.filter((f) => f.secrets.some((secret) => redactSecrets(f.text).includes(secret)))
const missed = leaks(formats)
const sweepMissed = leaks(sweep)
const harmless = [...HARMLESS, ...AUDIT4_HARMLESS]
const altered = harmless.filter((text) => redactSecrets(text) !== text)
console.log(`${ref ?? 'working tree'}: ${formats.length - missed.length}/${formats.length} formats masked, ${sweep.length - sweepMissed.length}/${sweep.length} lines of the fourth audit's .env sweep masked, ${altered.length}/${harmless.length} harmless strings altered`)
for (const f of missed) console.log(`  missed:  ${f.name}`)
const bySymbol = new Map<string, number>()
for (const { text } of sweepMissed) {
  const symbol = ENV_SWEEP.find((s) => s.text === text)!.symbol
  bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + 1)
}
if (bySymbol.size > 0) console.log(`  .env sweep leaks, by symbol: ${[...bySymbol].map(([s, n]) => `${s} ${n}/18`).join(', ')}`)
for (const text of altered) console.log(`  altered: ${JSON.stringify(text)}`)
if (!ref && (missed.length > 0 || sweepMissed.length > 0 || altered.length > 0)) process.exitCode = 1
