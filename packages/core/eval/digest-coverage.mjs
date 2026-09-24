#!/usr/bin/env node
/**
 * Offline, no API calls: which probes does the plugin's digest cover on the long-history variants?
 * Runs the shipped PreCompact hook (packages/claude-plugin/dist/preCompact.js, default scorer, so
 * keyword overlap and nothing sent) on each session's lengthened history, and reports the share of
 * probes with at least one of their entries preserved: all probes, and the ones no user message
 * states (the facts a compaction summary is most likely to lose, since it quotes the user).
 *
 * Used on the dev split to decide the digest's design before PREREGISTRATION.md's round 2.
 *
 *   node eval/digest-coverage.mjs [--split dev] [--target 80000]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { messagesToEntries } from '../dist/index.js'
import { DEFAULT_TARGET_TOKENS, lengthen } from './lengthen.mjs'
import { messageEntryId, toTranscript } from './transcript.mjs'
import { inSplit, parseSplit, taskSplit, tasksDir } from './split.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sessionsDir = join(here, '../../../examples/eval-sessions')
const { values: args } = parseArgs({ options: { split: { type: 'string', default: 'dev' }, target: { type: 'string' } } })
const split = parseSplit(args.split)
const target = Number(args.target ?? DEFAULT_TARGET_TOKENS)

let all = [0, 0]
let nonUser = [0, 0]
for (const task of readdirSync(tasksDir).filter((d) => statSync(join(tasksDir, d)).isDirectory() && inSplit(taskSplit(d), split))) {
  const sessionPath = join(sessionsDir, `recorded-${task}.json`)
  if (!existsSync(sessionPath)) continue
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
  const { messages: history, remapId } = lengthen(session.messages.slice(0, session.cutAfterMessage + 1), task, target)
  const entries = messagesToEntries(history)
  const roleOf = new Map(entries.map((e) => [e.id, e.role]))
  const probes = session.probes.map((p) => ({ ...p, entryIds: p.entryIds.map(remapId) })).filter((p) => p.entryIds.some((id) => roleOf.has(id)))

  const cwd = mkdtempSync(join(tmpdir(), `ctxjev-coverage-${task}-`))
  try {
    const sessionId = `coverage-${task}`
    const transcriptPath = join(cwd, 'transcript.jsonl')
    writeFileSync(transcriptPath, toTranscript(history, sessionId, cwd))
    const env = { PATH: process.env.PATH, CTXJEV_STATE_DIR: join(cwd, 'state') }
    const r = spawnSync('node', [join(here, '../../claude-plugin/dist/preCompact.js')], { input: JSON.stringify({ cwd, transcript_path: transcriptPath, session_id: sessionId }), encoding: 'utf8', env })
    if (r.status !== 0) throw new Error(r.stderr)
    const preservedPath = join(cwd, 'state', 'sessions', sessionId, 'preserved.json')
    const kept = new Set(existsSync(preservedPath) ? JSON.parse(readFileSync(preservedPath, 'utf8')).entries.map((e) => messageEntryId(e.entryId)) : [])
    const covered = (p) => p.entryIds.some((id) => kept.has(id))
    const userStated = (p) => p.entryIds.some((id) => roleOf.get(id) === 'user')
    const nu = probes.filter((p) => !userStated(p))
    all = [all[0] + probes.filter(covered).length, all[1] + probes.length]
    nonUser = [nonUser[0] + nu.filter(covered).length, nonUser[1] + nu.length]
    const keptRoles = [...kept].map((id) => roleOf.get(id)?.[0] ?? '?').join('')
    console.log(`${task.padEnd(22)} probes covered ${probes.filter(covered).length}/${probes.length}, not user-stated ${nu.filter(covered).length}/${nu.length}, digest roles ${keptRoles}`)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}
const pct = ([a, b]) => `${a}/${b} (${b ? Math.round((a / b) * 100) : 0}%)`
console.log(`\nAll probes covered: ${pct(all)}; probes no user message states: ${pct(nonUser)}`)
