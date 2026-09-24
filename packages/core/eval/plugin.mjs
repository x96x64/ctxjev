#!/usr/bin/env node
/**
 * Plugin eval: does ctxjev-claude help after a compaction?
 *
 * For each recorded session, the history up to "now implement the fix" is:
 * 1. written back out as a Claude Code transcript (.jsonl) and run through the shipped hooks,
 *    packages/claude-plugin/dist/preCompact.js then sessionStartCompact.js, as separate processes
 *    with the stdin Claude Code sends them. The second one prints the digest Claude Code would add.
 * 2. summarized by Claude Haiku 4.5 with a compaction prompt. Claude Code's own compaction prompt
 *    isn't public, so this one only approximates it. It asks for every user instruction, so the
 *    summary alone is a fair baseline, not a straw man.
 *
 * Then, the same way tasks.mjs and outcome.mjs measure: the agent finishes the task from
 * (A) the summary alone, (B) the summary plus the plugin's digest as it works today (goal inferred
 * from the latest user message), or (C) the summary plus the digest scored against a candidate goal,
 * the session's first request plus its latest instruction (set through a /ctxjev:set-goal record
 * in the transcript). A model also answers the probe questions whose facts come before the cut,
 * from the same contexts. The summary is made once per task and run, and every condition shares it.
 *
 * Round 2 (PREREGISTRATION.md, "Round 2: long histories") adds:
 * - `--history long`: each history padded to ~80k tokens of irrelevant tool traffic (lengthen.mjs),
 *   so the summary has to leave things out.
 * - `--compaction real`: the summary comes from Claude Code itself (`claude -p /compact --resume`
 *   on the transcript, in a throwaway config directory, with `--model haiku`), not our prompt.
 * - `--conditions`: `summary+digest(local)` and `summary+digest(jev)` are the shipped plugin with
 *   its inferred goal, scored offline (the 0.6.0 default) or with Jev (`CTXJEV_SCORER=jev`).
 * - `--agent-conditions`: which conditions also run the agent on the task (the costly part), and
 *   `--agent-runs N` on only the first N runs; probe answers run for every condition and run.
 *
 * Needs ANTHROPIC_API_KEY, and TYPESAFE_API_KEY for any Jev condition. By hand:
 *
 *   node eval/plugin.mjs --max-usd 3 [--runs N] [--split dev|holdout|all] [--task <prefix>] [--out results.json]
 *        [--history recorded|long] [--compaction simulated|real] [--conditions a,b] [--agent-conditions a,b]
 *   node eval/plugin.mjs --report eval/results/plugin.json
 *   node eval/plugin.mjs --selftest     # offline: lengthening, id remapping, and the local hook
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import { messagesToEntries } from '../dist/index.js'
import { createAgentRunner, tasksDir } from './agent.mjs'
import { inSplit, parseSplit, taskSplit } from './split.mjs'
import { lengthen } from './lengthen.mjs'
import { messageEntryId, toTranscript } from './transcript.mjs'
import { ANSWER_MODEL, SpendLimitError, bootstrap, createLimiter, createQA, createSpend, firstText, rateDifference, successRate, withCacheBreakpoint } from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDist = join(here, '../../claude-plugin/dist')
const sessionsDir = join(here, '../../../examples/eval-sessions')

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '1' },
    task: { type: 'string' },
    split: { type: 'string', default: 'all' },
    out: { type: 'string' },
    report: { type: 'string' },
    'max-usd': { type: 'string' },
    history: { type: 'string', default: 'recorded' },
    compaction: { type: 'string', default: 'simulated' },
    conditions: { type: 'string' },
    'agent-conditions': { type: 'string' },
    'agent-runs': { type: 'string' },
    selftest: { type: 'boolean' },
  },
})

// Each digest condition: the scorer the hook is told to use, and whether the goal is set to the
// first request plus the latest instruction through a /ctxjev:set-goal record.
const DIGESTS = {
  'summary+ctxjev': { scorer: 'jev', taskGoal: false },
  'summary+ctxjev(task goal)': { scorer: 'jev', taskGoal: true },
  'summary+digest(local)': { scorer: 'local', taskGoal: false },
  'summary+digest(jev)': { scorer: 'jev', taskGoal: false },
}
const ALL_CONDITIONS = ['summary', ...Object.keys(DIGESTS)]
const LEGACY_CONDITIONS = ['summary', 'summary+ctxjev', 'summary+ctxjev(task goal)']
const conditionList = (raw, fallback) => {
  const list = raw ? raw.split(',').map((c) => c.trim()) : fallback
  for (const c of list) if (!ALL_CONDITIONS.includes(c)) throw new Error(`unknown condition ${c}; one of ${ALL_CONDITIONS.join(', ')}`)
  return list
}
if (!['recorded', 'long'].includes(args.history)) throw new Error('--history must be recorded or long')
if (!['simulated', 'real'].includes(args.compaction)) throw new Error('--compaction must be simulated or real')

function printTable(rows, meta = {}) {
  const pct = (x) => `${Math.round(x * 100)}%`
  const ci = (rs, key) => {
    const [lo, hi] = bootstrap(rs, (r) => r.task, successRate(key))
    return `[${pct(lo)}, ${pct(hi)}]`
  }
  const tasks = rows.filter((r) => r.kind === 'task')
  const qa = rows.filter((r) => r.kind === 'qa')
  console.log(`\nAfter a ${meta.compaction ?? 'simulated'} compaction of ${meta.history ?? 'recorded'} histories (${ANSWER_MODEL}; 95% intervals resample tasks)\n`)
  console.log(`  ${'context'.padEnd(26)}${'tasks passed'.padStart(14)}${'95% CI'.padStart(14)}${'answers right'.padStart(15)}${'95% CI'.padStart(14)}`)
  const present = ALL_CONDITIONS.filter((c) => rows.some((r) => r.condition === c))
  for (const condition of present) {
    const t = tasks.filter((r) => r.condition === condition)
    const q = qa.filter((r) => r.condition === condition)
    const taskCells = t.length ? `${pct(successRate('success')(t)).padStart(14)}${ci(t, 'success').padStart(14)}` : `${'—'.padStart(14)}${''.padStart(14)}`
    console.log(`  ${condition.padEnd(26)}${taskCells}${pct(successRate('correct')(q)).padStart(15)}${ci(q, 'correct').padStart(14)}`)
  }
  const signed = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}`
  for (const variant of present.filter((c) => c !== 'summary')) {
    for (const [label, rs, key] of [['tasks passed', tasks, 'success'], ['answers right', qa, 'correct']]) {
      const both = rs.filter((r) => r.condition === variant || r.condition === 'summary')
      if (!both.some((r) => r.condition === variant) || !both.some((r) => r.condition === 'summary')) continue
      const diff = rateDifference(key, (r) => r.condition === variant, (r) => r.condition === 'summary')
      const [lo, hi] = bootstrap(both, (r) => r.task, diff)
      console.log(`  ${variant} − summary, ${label}: ${signed(diff(both))} pp [${signed(lo)}, ${signed(hi)}]`)
    }
  }
}

if (args.report) {
  const saved = JSON.parse(readFileSync(args.report, 'utf8'))
  printTable(saved.rows, saved)
  process.exit(0)
}

// A real hook inherits Claude Code's environment, network settings included. Forward those so the
// hook can reach Jev where outbound traffic goes through a proxy (a cloud sandbox), and nothing else.
const NETWORK_ENV = /^(?:https?_proxy|no_proxy|all_proxy|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|NODE_OPTIONS|SSL_CERT_FILE|SSL_CERT_DIR)$/i

const split = parseSplit(args.split)
const taskNames = readdirSync(tasksDir).filter(
  (d) => statSync(join(tasksDir, d)).isDirectory() && inSplit(taskSplit(d), split) && (!args.task || args.task.split(',').some((p) => d.startsWith(p))),
)
const conditions = conditionList(args.conditions, LEGACY_CONDITIONS)
const agentConditions = conditionList(args['agent-conditions'], conditions)
const agentRuns = args['agent-runs'] === undefined ? Infinity : Number(args['agent-runs'])
if (!conditions.includes('summary')) throw new Error('--conditions must include summary, the baseline')

/** The session's history before the fix prompt (lengthened with --history long), and its probes' entry ids to match. */
function loadSession(task) {
  const session = JSON.parse(readFileSync(join(sessionsDir, `recorded-${task}.json`), 'utf8'))
  const recorded = session.messages.slice(0, session.cutAfterMessage + 1)
  const { messages: history, remapId } = args.history === 'long' ? lengthen(recorded, task) : { messages: recorded, remapId: (id) => id }
  const beforeCut = new Set(messagesToEntries(history).map((e) => e.id))
  const probes = session.probes.map((p) => ({ ...p, entryIds: p.entryIds.map(remapId) })).filter((p) => p.entryIds.some((id) => beforeCut.has(id)))
  return { history, probes, beforeCut }
}

if (args.selftest) {
  // Offline: every probe still resolves after lengthening, lengthening is deterministic, and the
  // default (local) hook produces a digest whose ids map back onto the history.
  let failures = 0
  for (const task of taskNames.filter((t) => existsSync(join(sessionsDir, `recorded-${t}.json`)))) {
    const session = JSON.parse(readFileSync(join(sessionsDir, `recorded-${task}.json`), 'utf8'))
    const recorded = session.messages.slice(0, session.cutAfterMessage + 1)
    const recordedIds = new Set(messagesToEntries(recorded).map((e) => e.id))
    const { history, probes, beforeCut } = loadSession(task)
    const lost = session.probes.filter((p) => p.entryIds.some((id) => recordedIds.has(id))).length - probes.length
    const again = JSON.stringify(lengthen(recorded, task).messages) === JSON.stringify(lengthen(recorded, task).messages)
    const { preservedIds, lastRun } = pluginDigest(history, task, undefined, 'local')
    const unmapped = preservedIds.filter((id) => !beforeCut.has(id))
    const ok = lost === 0 && again && lastRun.scorer === 'local' && unmapped.length === 0
    if (!ok) failures++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${task}: ${probes.length} probes (${lost} lost), deterministic ${again}, scorer ${lastRun.scorer}, ${preservedIds.length} preserved (${unmapped.length} unmapped)`)
  }
  process.exit(failures ? 1 : 0)
}

const runs = Number(args.runs)
const maxUsd = Number(args['max-usd'])
if (!(maxUsd > 0)) throw new Error('--max-usd is required: the most this run may spend, in dollars')
const needsJev = conditions.some((c) => DIGESTS[c]?.scorer === 'jev')
for (const key of ['ANTHROPIC_API_KEY', ...(needsJev ? ['TYPESAFE_API_KEY'] : [])]) if (!process.env[key]) throw new Error(`${key} is not set`)

const client = new Anthropic()
const spend = createSpend(maxUsd)
const limit = createLimiter(5)
const runAgent = createAgentRunner({ client, spend, limit, model: ANSWER_MODEL, maxTurns: 25 })
const { answer, judge } = createQA({ client, spend, limit })


function runHook(script, input, stateDir, scorer) {
  const network = Object.fromEntries(Object.entries(process.env).filter(([key]) => NETWORK_ENV.test(key)))
  const env = { PATH: process.env.PATH, TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY, CTXJEV_STATE_DIR: stateDir, CTXJEV_SCORER: scorer, ...network }
  const r = spawnSync('node', [join(pluginDist, script)], { input: JSON.stringify(input), encoding: 'utf8', env, timeout: 30_000 })
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}: ${r.stderr}`)
  return r.stdout.trim()
}

function pluginDigest(history, task, goal, scorer = 'jev') {
  const cwd = mkdtempSync(join(tmpdir(), `ctxjev-plugin-${task}-`))
  try {
    const sessionId = `eval-${task}`
    const transcriptPath = join(cwd, 'transcript.jsonl')
    // With a goal, the transcript ends in the record that running /ctxjev:set-goal <goal> leaves.
    const setGoal = goal && `\n${JSON.stringify({ type: 'user', uuid: 'set-goal', sessionId, cwd, message: { role: 'user', content: `<command-name>/ctxjev:set-goal</command-name>\n<command-args>${goal}</command-args>` } })}`
    writeFileSync(transcriptPath, toTranscript(history, sessionId, cwd) + (setGoal || ''))
    const stateDir = join(cwd, 'state')
    runHook('preCompact.js', { cwd, transcript_path: transcriptPath, session_id: sessionId }, stateDir, scorer)
    const lastRun = JSON.parse(readFileSync(join(stateDir, 'sessions', sessionId, 'last-run.json'), 'utf8'))
    const preservedPath = join(stateDir, 'sessions', sessionId, 'preserved.json')
    const preservedIds = existsSync(preservedPath) ? JSON.parse(readFileSync(preservedPath, 'utf8')).entries.map((e) => messageEntryId(e.entryId)) : []
    const digest = runHook('sessionStartCompact.js', { cwd, session_id: sessionId }, stateDir)
    return { digest, preservedIds, lastRun: { outcome: lastRun.outcome, scorer: lastRun.scorer, preserved: lastRun.preserved, goal: lastRun.goal, reason: lastRun.reason } }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const COMPACTION_PROMPT =
  'Your task is to write a detailed summary of the conversation so far, so the work can continue from the summary alone. ' +
  'Include: (1) the user\'s requests, and every instruction or constraint they gave, quoted where the exact wording matters; ' +
  '(2) what was found, with the evidence (files, functions, commands, and their results); (3) decisions made and options ruled out; ' +
  '(4) the current state and the next step. Be specific: keep names, numbers, and paths. Write only the summary.'

async function simulatedSummary(history) {
  const names = new Set()
  for (const m of history) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') names.add(b.name)
  const tools = [...names].sort().map((name) => ({ name, description: `The ${name} tool used earlier.`, input_schema: { type: 'object', additionalProperties: true } }))
  spend.check()
  const response = await limit(() =>
    client.messages.create({
      model: ANSWER_MODEL,
      max_tokens: 3000,
      ...(tools.length > 0 && { tools, tool_choice: { type: 'none' } }),
      messages: [...withCacheBreakpoint(history), { role: 'user', content: `${COMPACTION_PROMPT}\n\n(No tools are available for this; write the summary as plain text.)` }],
    }),
  )
  spend.record(ANSWER_MODEL, response.usage)
  return continuation(firstText(response))
}

/**
 * Claude Code's own compaction: the history as a transcript in a throwaway config directory, then
 * `claude -p /compact --resume`, which writes the summary back into the transcript as its
 * isCompactSummary record (already framed as "This session is being continued…"). A clean
 * environment, as record.mjs uses, so no personal settings, hooks, or MCP servers take part;
 * `--model haiku` is a cost choice, where a real session would compact with its own model.
 */
function realSummary(history, task) {
  const dir = mkdtempSync(join(tmpdir(), `ctxjev-compact-${task}-`))
  try {
    const cwd = join(dir, 'workspace', task)
    const config = join(dir, 'config')
    const sessionId = randomUUID()
    const projectDir = join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
    mkdirSync(cwd, { recursive: true })
    mkdirSync(projectDir, { recursive: true })
    const transcriptPath = join(projectDir, `${sessionId}.jsonl`)
    writeFileSync(transcriptPath, `${toTranscript(history, sessionId, cwd)}\n`)
    const network = Object.fromEntries(Object.entries(process.env).filter(([key]) => NETWORK_ENV.test(key)))
    const env = { HOME: join(dir, 'home'), PATH: process.env.PATH, LANG: 'en_US.UTF-8', CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ...network }
    spend.check()
    const r = spawnSync('claude', ['-p', '/compact', '--resume', sessionId, '--model', 'haiku', '--output-format', 'json', '--setting-sources', 'project,local', '--strict-mcp-config'], { cwd, env, encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 })
    if (r.status !== 0) throw new Error(`claude /compact exited ${r.status}: ${r.stderr || r.stdout}`)
    const result = JSON.parse(r.stdout)
    if (result.is_error) throw new Error(`claude /compact failed: ${result.result}`)
    for (const [model, u] of Object.entries(result.modelUsage ?? {})) {
      if (!model.startsWith(ANSWER_MODEL)) throw new Error(`claude /compact used ${model}, expected ${ANSWER_MODEL}`)
      spend.record(ANSWER_MODEL, { input_tokens: u.inputTokens, output_tokens: u.outputTokens, cache_read_input_tokens: u.cacheReadInputTokens, cache_creation_input_tokens: u.cacheCreationInputTokens })
    }
    const summary = readFileSync(transcriptPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).find((record) => record.isCompactSummary)
    if (!summary) throw new Error('claude /compact left no isCompactSummary record in the transcript')
    const content = summary.message.content
    return typeof content === 'string' ? content : content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const userText = (m) => (typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'))

/** A candidate for a better inferred goal: the task the session started with, plus where it is now. */
function taskAndLatestGoal(history) {
  const users = history.filter((m) => m.role === 'user' && userText(m).trim())
  const task = userText(users[0])
  const latest = userText(users[users.length - 1])
  return latest === task ? task : `${task}\n\nLatest instruction: ${latest}`
}

const continuation = (summary) =>
  `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n${summary}`

const rows = []
try {
  for (const task of taskNames) {
    if (!existsSync(join(sessionsDir, `recorded-${task}.json`))) continue
    const { prompts, language } = JSON.parse(readFileSync(join(tasksDir, task, 'task.json'), 'utf8'))
    const { history, probes } = loadSession(task)

    for (let run = 0; run < runs; run++) {
      const summary = args.compaction === 'real' ? realSummary(history, task) : await simulatedSummary(history)
      const digests = {}
      for (const condition of conditions.filter((c) => DIGESTS[c])) {
        const { scorer, taskGoal } = DIGESTS[condition]
        digests[condition] = pluginDigest(history, task, taskGoal ? taskAndLatestGoal(history) : undefined, scorer)
        const got = digests[condition].lastRun.scorer
        if (got !== scorer) throw new Error(`${task} ${condition}: the plugin scored with ${got} (${digests[condition].lastRun.reason ?? ''}), not ${scorer}`)
      }
      const contexts = Object.fromEntries(
        conditions.map((condition) => [
          condition,
          DIGESTS[condition]
            ? [{ role: 'user', content: [{ type: 'text', text: summary }, { type: 'text', text: `<system-reminder>\n${digests[condition].digest}\n</system-reminder>` }] }]
            : [{ role: 'user', content: summary }],
        ]),
      )
      await Promise.all(
        Object.entries(contexts).map(async ([condition, context]) => {
          if (agentConditions.includes(condition) && run < agentRuns) {
            const result = await runAgent(task, context, prompts[prompts.length - 1])
            rows.push({ kind: 'task', task, language, condition, run, ...result, pluginRun: digests[condition]?.lastRun })
            process.stderr.write(`${task} ${condition} #${run + 1}: ${result.success ? 'PASS' : 'fail'} ${result.failedTests.join('; ')}\n`)
          }
          const preserved = new Set(digests[condition]?.preservedIds ?? [])
          for (const probe of probes) {
            const reply = await answer(context, probe.question)
            const inDigest = probe.entryIds.some((id) => preserved.has(id))
            rows.push({ kind: 'qa', task, language, condition, run, question: probe.question, fact: probe.fact, inDigest, reply, correct: await judge(probe, reply) })
          }
        }),
      )
      rows.push({ kind: 'context', task, run, summary, digests: Object.fromEntries(Object.entries(digests).map(([c, d]) => [c, { digest: d.digest, preservedIds: d.preservedIds, lastRun: d.lastRun }])) })
    }
    process.stderr.write(`${task} done — $${spend.total.toFixed(2)} so far\n`)
  }
} catch (err) {
  // Written anyway, marked partial, so a run the spend cap stops is still on record (and never
  // silently rerun with a higher cap).
  console.error(`Stopped: ${err instanceof SpendLimitError ? err.message : err.stack}`)
  console.error(`API usage before stopping: ${spend.summary()}`)
  if (args.out) writeFileSync(args.out, `${JSON.stringify({ partial: true, stoppedBy: String(err.message ?? err), model: ANSWER_MODEL, runs, history: args.history, compaction: args.compaction, conditions, agentConditions, spendUsd: spend.total, rows }, null, 1)}\n`)
  process.exit(1)
}

const meta = { model: ANSWER_MODEL, runs, history: args.history, compaction: args.compaction, conditions, agentConditions, agentRuns: Number.isFinite(agentRuns) ? agentRuns : runs }
printTable(rows, meta)
console.log(`\nAPI usage this run: ${spend.summary()}`)
if (args.out) {
  writeFileSync(args.out, `${JSON.stringify({ ...meta, compactionPrompt: args.compaction === 'real' ? 'Claude Code /compact' : COMPACTION_PROMPT, spendUsd: spend.total, rows }, null, 1)}\n`)
  console.log(`Wrote summaries, digests, runs, and answers to ${args.out}`)
}
