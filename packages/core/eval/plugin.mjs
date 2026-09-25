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
 * (A) the summary alone, (B) the summary plus the plugin's digest with the goal the plugin infers
 * itself, or (C) the summary plus the digest scored against the session's first request plus its
 * latest instruction, set through a /ctxjev:set-goal record in the transcript. When plugin.json
 * (dev) was recorded, the plugin inferred the goal from the latest message alone (0.4.0), so (B)
 * and (C) differed; since 0.5.0 it infers exactly (C)'s goal, so on the holdout runs they are the
 * same goal supplied two ways (see eval/results/README.md). The digest is scored with Jev
 * (CTXJEV_SCORER=jev), as every saved result was. A model also answers the probe questions whose facts come before the cut,
 * from the same contexts. The summary is made once per task and run, and every condition shares it.
 *
 * Needs ANTHROPIC_API_KEY and TYPESAFE_API_KEY. By hand:
 *
 *   node eval/plugin.mjs --max-usd 3 [--runs N] [--split dev|holdout|all] [--task <prefix>] [--out results.json]
 *   node eval/plugin.mjs --report eval/results/plugin.json
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import { messagesToEntries } from '../dist/index.js'
import { createAgentRunner, tasksDir } from './agent.mjs'
import { inSplit, parseSplit, taskSplit } from './split.mjs'
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
  },
})

function printTable(rows) {
  const pct = (x) => `${Math.round(x * 100)}%`
  const ci = (rs, key) => {
    const [lo, hi] = bootstrap(rs, (r) => r.task, successRate(key))
    return `[${pct(lo)}, ${pct(hi)}]`
  }
  const tasks = rows.filter((r) => r.kind === 'task')
  const qa = rows.filter((r) => r.kind === 'qa')
  console.log(`\nAfter a simulated compaction (${ANSWER_MODEL}; 95% intervals resample tasks)\n`)
  console.log(`  ${'context'.padEnd(22)}${'tasks passed'.padStart(14)}${'95% CI'.padStart(14)}${'answers right'.padStart(15)}${'95% CI'.padStart(14)}`)
  for (const condition of ['summary', 'summary+ctxjev', 'summary+ctxjev(task goal)'].filter((c) => rows.some((r) => r.condition === c))) {
    const t = tasks.filter((r) => r.condition === condition)
    const q = qa.filter((r) => r.condition === condition)
    console.log(`  ${condition.padEnd(22)}${pct(successRate('success')(t)).padStart(14)}${ci(t, 'success').padStart(14)}${pct(successRate('correct')(q)).padStart(15)}${ci(q, 'correct').padStart(14)}`)
  }
  const signed = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}`
  for (const variant of ['summary+ctxjev', 'summary+ctxjev(task goal)'].filter((c) => rows.some((r) => r.condition === c))) {
    for (const [label, rs, key] of [['tasks passed', tasks, 'success'], ['answers right', qa, 'correct']]) {
      const both = rs.filter((r) => r.condition === variant || r.condition === 'summary')
      const diff = rateDifference(key, (r) => r.condition === variant, (r) => r.condition === 'summary')
      const [lo, hi] = bootstrap(both, (r) => r.task, diff)
      console.log(`  ${variant} − summary, ${label}: ${signed(diff(both))} pp [${signed(lo)}, ${signed(hi)}]`)
    }
  }
}

if (args.report) {
  printTable(JSON.parse(readFileSync(args.report, 'utf8')).rows)
  process.exit(0)
}

const runs = Number(args.runs)
const maxUsd = Number(args['max-usd'])
if (!(maxUsd > 0)) throw new Error('--max-usd is required: the most this run may spend, in dollars')
for (const key of ['ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY']) if (!process.env[key]) throw new Error(`${key} is not set`)

const client = new Anthropic()
const spend = createSpend(maxUsd)
const limit = createLimiter(5)
const runAgent = createAgentRunner({ client, spend, limit, model: ANSWER_MODEL, maxTurns: 25 })
const { answer, judge } = createQA({ client, spend, limit })

/** The history as Claude Code writes it, so the shipped hooks parse exactly what they would in use. */
function toTranscript(messages, sessionId, cwd) {
  const start = Date.parse('2026-09-23T01:00:00Z')
  return messages
    .map((m, i) => JSON.stringify({
      type: m.role,
      uuid: `rec-${i}`,
      sessionId,
      cwd,
      timestamp: new Date(start + i * 1000).toISOString(),
      message: { role: m.role, ...(m.role === 'assistant' && { id: `msg_${i}` }), content: m.role === 'assistant' && typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content },
    }))
    .join('\n')
}

// A real hook inherits Claude Code's environment, network settings included. Forward those so the
// hook can reach Jev where outbound traffic goes through a proxy (a cloud sandbox), and nothing else.
const NETWORK_ENV = /^(?:https?_proxy|no_proxy|all_proxy|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|NODE_OPTIONS|SSL_CERT_FILE|SSL_CERT_DIR)$/i

function runHook(script, input, stateDir) {
  const network = Object.fromEntries(Object.entries(process.env).filter(([key]) => NETWORK_ENV.test(key)))
  // CTXJEV_SCORER=jev: since 0.6.0 the plugin scores offline unless asked, and every condition here
  // measures the Jev-scored digest the saved results were made with.
  const env = { PATH: process.env.PATH, TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY, CTXJEV_SCORER: 'jev', CTXJEV_STATE_DIR: stateDir, ...network }
  const r = spawnSync('node', [join(pluginDist, script)], { input: JSON.stringify(input), encoding: 'utf8', env, timeout: 30_000 })
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}: ${r.stderr}`)
  return r.stdout.trim()
}

function pluginDigest(history, task, goal) {
  const cwd = mkdtempSync(join(tmpdir(), `ctxjev-plugin-${task}-`))
  try {
    const sessionId = `eval-${task}`
    const transcriptPath = join(cwd, 'transcript.jsonl')
    // With a goal, the transcript ends in the record that running /ctxjev:set-goal <goal> leaves.
    const setGoal = goal && `\n${JSON.stringify({ type: 'user', uuid: 'set-goal', sessionId, cwd, message: { role: 'user', content: `<command-name>/ctxjev:set-goal</command-name>\n<command-args>${goal}</command-args>` } })}`
    writeFileSync(transcriptPath, toTranscript(history, sessionId, cwd) + (setGoal || ''))
    const stateDir = join(cwd, 'state')
    runHook('preCompact.js', { cwd, transcript_path: transcriptPath, session_id: sessionId }, stateDir)
    const lastRun = JSON.parse(readFileSync(join(stateDir, 'sessions', sessionId, 'last-run.json'), 'utf8'))
    const digest = runHook('sessionStartCompact.js', { cwd, session_id: sessionId }, stateDir)
    return { digest, lastRun: { outcome: lastRun.outcome, scorer: lastRun.scorer, preserved: lastRun.preserved, goal: lastRun.goal, reason: lastRun.reason } }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const COMPACTION_PROMPT =
  'Your task is to write a detailed summary of the conversation so far, so the work can continue from the summary alone. ' +
  'Include: (1) the user\'s requests, and every instruction or constraint they gave, quoted where the exact wording matters; ' +
  '(2) what was found, with the evidence (files, functions, commands, and their results); (3) decisions made and options ruled out; ' +
  '(4) the current state and the next step. Be specific: keep names, numbers, and paths. Write only the summary.'

async function summarize(history) {
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
  return firstText(response)
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

const split = parseSplit(args.split)
const taskNames = readdirSync(tasksDir).filter(
  (d) => statSync(join(tasksDir, d)).isDirectory() && inSplit(taskSplit(d), split) && (!args.task || args.task.split(',').some((p) => d.startsWith(p))),
)
const rows = []
try {
  for (const task of taskNames) {
    const sessionPath = join(sessionsDir, `recorded-${task}.json`)
    if (!existsSync(sessionPath)) continue
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
    const { prompts, language } = JSON.parse(readFileSync(join(tasksDir, task, 'task.json'), 'utf8'))
    const history = session.messages.slice(0, session.cutAfterMessage + 1)
    const beforeCut = new Set(messagesToEntries(history).map((e) => e.id))
    const probes = session.probes.filter((p) => p.entryIds.some((id) => beforeCut.has(id)))

    for (let run = 0; run < runs; run++) {
      const summary = await summarize(history)
      const plugin = pluginDigest(history, task)
      const withTaskGoal = pluginDigest(history, task, taskAndLatestGoal(history))
      for (const run of [plugin, withTaskGoal]) {
        if (run.lastRun.scorer !== 'jev') throw new Error(`${task}: the plugin scored with ${run.lastRun.scorer} (${run.lastRun.reason ?? ''}), not Jev`)
      }
      const withDigest = (digest) => [{ role: 'user', content: [{ type: 'text', text: continuation(summary) }, { type: 'text', text: `<system-reminder>\n${digest}\n</system-reminder>` }] }]
      const contexts = {
        summary: [{ role: 'user', content: continuation(summary) }],
        'summary+ctxjev': withDigest(plugin.digest),
        'summary+ctxjev(task goal)': withDigest(withTaskGoal.digest),
      }
      const { digest, lastRun } = plugin
      await Promise.all(
        Object.entries(contexts).map(async ([condition, context]) => {
          const result = await runAgent(task, context, prompts[prompts.length - 1])
          rows.push({ kind: 'task', task, language, condition, run, ...result, pluginRun: lastRun })
          process.stderr.write(`${task} ${condition} #${run + 1}: ${result.success ? 'PASS' : 'fail'} ${result.failedTests.join('; ')}\n`)
          for (const probe of probes) {
            const reply = await answer(context, probe.question)
            rows.push({ kind: 'qa', task, language, condition, run, question: probe.question, fact: probe.fact, reply, correct: await judge(probe, reply) })
          }
        }),
      )
      rows.push({ kind: 'context', task, run, summary, digest, pluginRun: lastRun, taskGoalDigest: withTaskGoal.digest, taskGoalRun: withTaskGoal.lastRun })
    }
    process.stderr.write(`${task} done — $${spend.total.toFixed(2)} so far\n`)
  }
} catch (err) {
  console.error(`Stopped: ${err instanceof SpendLimitError ? err.message : err.stack}. Nothing is written for a partial run.`)
  console.error(`API usage before stopping: ${spend.summary()}`)
  process.exit(1)
}

printTable(rows)
console.log(`\nAPI usage this run: ${spend.summary()}`)
if (args.out) {
  writeFileSync(args.out, `${JSON.stringify({ model: ANSWER_MODEL, runs, compactionPrompt: COMPACTION_PROMPT, rows }, null, 1)}\n`)
  console.log(`Wrote summaries, digests, runs, and answers to ${args.out}`)
}
