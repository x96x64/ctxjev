#!/usr/bin/env node
/**
 * Checks every eval session against the rules its task's format adds (see probes.mjs): today, a
 * Japanese format-2 task's probes are in Japanese. Offline, no API calls. CI runs it.
 *
 *   node eval/check-sessions.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeLanguageProblems, taskSpecFor } from './probes.mjs'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/eval-sessions')
let checked = 0
const problems = []
for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const session = JSON.parse(readFileSync(join(dir, name), 'utf8'))
  const spec = taskSpecFor(session)
  if (!spec || (spec.format ?? 1) < 2) continue
  checked++
  problems.push(...probeLanguageProblems(spec, session.probes ?? []).map((p) => `${name}: ${p}`))
}
for (const p of problems) console.error(p)
console.log(`check-sessions: ${checked} session(s) of format-2 tasks checked, ${problems.length} problem(s)`)
process.exit(problems.length > 0 ? 1 : 0)
