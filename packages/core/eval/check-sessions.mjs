#!/usr/bin/env node
/**
 * Checks every eval session in Japanese against the language rule (see probes.mjs): its probes'
 * questions and facts are in Japanese. A session is in Japanese when its task's task.json says so,
 * or, for a hand-written session with no task, when the session does. Offline, no API calls. CI
 * runs it.
 *
 * Format-2 tasks (Round 2 on) must follow the rule. Round 1's format-1 sessions are checked too,
 * against what's known: two Japanese holdout sessions were recorded with English probes (the fourth
 * audit counted 14 questions), which Round 2 will rewrite; until then each is allowed exactly the
 * English fields it has, so a new one fails. It fails when it checks no session at all: in 0.7.0 it
 * checked only format-2 sessions, of which there are none yet, and passed protecting nothing (the
 * fourth audit's P1-4).
 *
 *   node eval/check-sessions.mjs [--sessions <dir>]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { japaneseProbeProblems, probeLanguageProblems, taskSpecFor } from './probes.mjs'

const { values } = parseArgs({ options: { sessions: { type: 'string' } } })
const dir = values.sessions ?? join(dirname(fileURLToPath(import.meta.url)), '../../../examples/eval-sessions')

// Format-1 sessions recorded with English probes, and how many of their fields are English.
const KNOWN_ENGLISH_FIELDS = new Map([
  ['recorded-room-booking.json', 14],
  ['recorded-shipping-fee.json', 12],
])

let checked = 0
let known = 0
const problems = []
for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const session = JSON.parse(readFileSync(join(dir, name), 'utf8'))
  const spec = taskSpecFor(session)
  const language = spec ? spec.language : session.language
  if (language !== 'ja') continue
  checked++
  const probes = session.probes ?? []
  if (spec && (spec.format ?? 1) >= 2) {
    problems.push(...probeLanguageProblems(spec, probes).map((p) => `${name}: ${p}`))
    continue
  }
  const english = japaneseProbeProblems(probes, spec ? 'a Japanese task' : 'a Japanese session')
  const allowed = KNOWN_ENGLISH_FIELDS.get(name) ?? 0
  if (english.length === allowed) known += allowed
  else problems.push(...english.map((p) => `${name}: ${p}`), ...(allowed > 0 ? [`${name}: ${english.length} English field(s), where ${allowed} are known`] : []))
}
for (const p of problems) console.error(p)
if (checked === 0) {
  console.error(`check-sessions: no session was checked in ${dir} — the rule would be protecting nothing`)
  process.exit(1)
}
console.log(`check-sessions: ${checked} Japanese session(s) checked, ${problems.length} problem(s)${known > 0 ? `, ${known} known English field(s) in ${KNOWN_ENGLISH_FIELDS.size} format-1 session(s)` : ''}`)
process.exit(problems.length > 0 ? 1 : 0)
