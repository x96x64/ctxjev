#!/usr/bin/env node
/**
 * Task-completion eval: can an agent still finish the job after its history is pruned?
 *
 * Each task in examples/eval-tasks has a recorded Claude Code session
 * (examples/eval-sessions/recorded-<task>.json): an investigation where the user states
 * constraints along the way, then "now implement the fix". The history up to that last request is
 * pruned to 25% of its tokens (ranked by Jev, keyword overlap, or newest-first), or kept whole, or
 * cut to the task alone. Claude Haiku 4.5 then gets the fix request and works in a fresh copy of
 * the repo with the same tools the recording used (Bash, Read, Edit, Write, Grep, Glob). Success
 * means the task's hidden acceptance tests pass. They check the constraints the user stated
 * mid-session too, which only the history knows about.
 *
 * Tool calls run for real, but only inside the temporary copy: file tools refuse paths outside it,
 * and commands get a minimal environment with no API keys and a 60-second limit.
 *
 * Not in CI (needs ANTHROPIC_API_KEY and TYPESAFE_API_KEY, costs money). By hand:
 *
 *   node eval/tasks.mjs --max-usd 6 [--runs N] [--split dev|holdout|all] [--task <prefix>] [--conditions full,jev] [--out results.json] [--merge previous.json]
 *   node eval/tasks.mjs --report eval/results/tasks.json
 *   node eval/tasks.mjs --selftest   (no API calls: solution applied through the tools passes, untouched fails)
 */
import { existsSync, globSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import { ANSWER_MODEL, SpendLimitError, bootstrap, createLimiter, createSpend, pruneTo, rankings, rateDifference, successRate } from './lib.mjs'
import { createAgentRunner, freshRepo, grade, tasksDir, workspaceTools } from './agent.mjs'
import { inSplit, parseSplit, taskSplit } from './split.mjs'

const BUDGET = 0.25
const ALL_CONDITIONS = ['full', 'jev', 'keywords', 'recency', 'goal-only']
// A pruned condition can add pruneMessages options: `jev+user` (keepUserText), `jev+user+marker`.
const FLAGS = { user: 'keepUserText', marker: 'marker' }
function parseCondition(condition) {
  const [base, ...flags] = condition.split('+')
  if (!ALL_CONDITIONS.includes(base) || flags.some((f) => !(f in FLAGS)) || (flags.length > 0 && (base === 'full' || base === 'goal-only'))) {
    throw new Error(`unknown condition ${condition}`)
  }
  return { base, extra: Object.fromEntries(flags.map((f) => [FLAGS[f], true])) }
}

const examples = join(dirname(fileURLToPath(import.meta.url)), '../../../examples')

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '1' },
    task: { type: 'string' },
    // dev (the ten tasks 0.5.0 was designed on), holdout (see PREREGISTRATION.md), or all.
    split: { type: 'string', default: 'all' },
    conditions: { type: 'string' },
    out: { type: 'string' },
    merge: { type: 'string' },
    report: { type: 'string' },
    selftest: { type: 'boolean' },
    'max-usd': { type: 'string' },
    'max-turns': { type: 'string', default: '25' },
    // Claude Sonnet 5 runs at effort low, to spend less on thinking.
    'agent-model': { type: 'string', default: ANSWER_MODEL },
    // Numbers this invocation's runs from N, so a later invocation can add runs to --merge'd results.
    'run-offset': { type: 'string', default: '0' },
  },
})

// --- report ------------------------------------------------------------------------------------

function printTable(rows, model = ANSWER_MODEL) {
  const conditions = [...new Set(rows.map((r) => r.condition))].sort((a, b) => ALL_CONDITIONS.indexOf(a.split('+')[0]) - ALL_CONDITIONS.indexOf(b.split('+')[0]) || a.localeCompare(b))
  const pct = (x) => (Number.isNaN(x) ? '-' : `${Math.round(x * 100)}%`)
  const rate = (xs) => (xs.length === 0 ? '   -  ' : pct(successRate('success')(xs)).padStart(6))
  const ci = (xs) => {
    const [lo, hi] = bootstrap(xs, (r) => r.task, successRate('success'))
    return `[${pct(lo)}, ${pct(hi)}]`
  }
  const tasks = [...new Set(rows.map((r) => r.task))]
  console.log(`\nHidden acceptance tests passed (${model} as the agent; history pruned to ${BUDGET * 100}% except full / goal-only; 95% intervals resample tasks)\n`)
  console.log(`  ${'condition'.padEnd(20)}${'all'.padStart(6)}${'95% CI'.padStart(13)}${'en'.padStart(7)}${'ja'.padStart(7)}${'turns'.padStart(7)}   ${tasks.map((t) => t.slice(0, 9).padStart(10)).join('')}`)
  for (const c of conditions) {
    const rs = rows.filter((r) => r.condition === c)
    const turns = rs.reduce((s, r) => s + r.turns, 0) / rs.length
    console.log(
      `  ${c.padEnd(20)}${rate(rs)}${ci(rs).padStart(13)}${rate(rs.filter((r) => r.language === 'en')).padStart(7)}${rate(rs.filter((r) => r.language === 'ja')).padStart(7)}` +
        `${turns.toFixed(1).padStart(7)}   ${tasks.map((t) => rate(rs.filter((r) => r.task === t)).padStart(10)).join('')}`,
    )
  }
  const jevLike = conditions.filter((c) => c.startsWith('jev'))
  const others = conditions.filter((c) => /^(recency|keywords)/.test(c))
  if (jevLike.length && others.length) {
    console.log('\n  Differences in tasks passed (same tasks resampled together):')
    for (const a of jevLike) {
      for (const b of others) {
        const both = rows.filter((r) => r.condition === a || r.condition === b)
        const diff = rateDifference('success', (r) => r.condition === a, (r) => r.condition === b)
        const [lo, hi] = bootstrap(both, (r) => r.task, diff)
        const signed = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}`
        console.log(`    ${`${a} − ${b}`.padEnd(40)}${signed(diff(both)).padStart(5)} pp   [${signed(lo)}, ${signed(hi)}]`)
      }
    }
  }
}

if (args.report) {
  const saved = JSON.parse(readFileSync(args.report, 'utf8'))
  printTable(saved.rows, saved.agentModel)
  process.exit(0)
}

const split = parseSplit(args.split)
const taskNames = readdirSync(tasksDir).filter(
  (d) => statSync(join(tasksDir, d)).isDirectory() && inSplit(taskSplit(d), split) && (!args.task || args.task.split(',').some((p) => d.startsWith(p))),
)

if (args.selftest) {
  let ok = true
  for (const task of taskNames) {
    const untouched = freshRepo(task)
    const before = grade(task, untouched.repo)
    rmSync(untouched.work, { recursive: true, force: true })

    const { work, repo } = freshRepo(task)
    const run = workspaceTools(task, repo)
    const results = [run('Read', { file_path: `/workspace/${task}/package.json` }), run('Glob', { pattern: 'src/**/*.js' }), run('Grep', { pattern: 'export', path: 'src' }), run('Bash', { command: `ls /workspace/${task}` }), run('Read', { file_path: '/etc/passwd' })]
    const escapeRefused = results[4].is_error === true
    const solutionDir = join(tasksDir, task, 'solution')
    for (const file of globSync('**/*', { cwd: solutionDir }).filter((p) => statSync(join(solutionDir, p)).isFile())) {
      results.push(run('Write', { file_path: `/workspace/${task}/${file}`, content: readFileSync(join(solutionDir, file), 'utf8') }))
    }
    const after = grade(task, repo)
    rmSync(work, { recursive: true, force: true })
    const toolsOk = results.slice(0, 4).every((r) => !r.is_error) && results.slice(5).every((r) => !r.is_error)
    const pass = !before.success && after.success && escapeRefused && toolsOk
    ok &&= pass
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${task.padEnd(20)} untouched: ${before.passed}/${before.passed + before.failed} hidden tests, solution via tools: ${after.passed}/${after.passed + after.failed}, tools ok: ${toolsOk}, escape refused: ${escapeRefused}`)
  }
  process.exit(ok ? 0 : 1)
}

// --- agent runs --------------------------------------------------------------------------------

const runs = Number(args.runs)
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a whole number of at least 1, got ${args.runs}`)
const maxUsd = Number(args['max-usd'])
if (!(maxUsd > 0)) throw new Error('--max-usd is required: the most this run may spend, in dollars')
const maxTurns = Number(args['max-turns'])
const conditions = args.conditions ? args.conditions.split(',') : ALL_CONDITIONS
for (const c of conditions) parseCondition(c)
for (const key of ['ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY']) if (!process.env[key]) throw new Error(`${key} is not set`)

const client = new Anthropic()
const spend = createSpend(maxUsd)
const limit = createLimiter(5)

const agentModel = args['agent-model']
const runAgent = createAgentRunner({ client, spend, limit, model: agentModel, maxTurns, extraParams: agentModel === ANSWER_MODEL ? {} : { output_config: { effort: 'low' } } })

const rows = []
try {
  for (const task of taskNames) {
    const sessionPath = join(examples, 'eval-sessions', `recorded-${task}.json`)
    if (!existsSync(sessionPath)) {
      console.error(`skipping ${task}: no recorded session`)
      continue
    }
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
    const { prompts, language } = JSON.parse(readFileSync(join(tasksDir, task, 'task.json'), 'utf8'))
    const history = session.messages.slice(0, session.cutAfterMessage + 1)
    const ranked = await rankings(history, session.goal)
    const histories = {}
    for (const c of conditions) {
      const { base, extra } = parseCondition(c)
      histories[c] = base === 'full' ? history : base === 'goal-only' ? [history[0]] : await pruneTo(history, session.goal, ranked[base], base, BUDGET, extra)
    }
    const offset = Number(args['run-offset'])
    const jobs = conditions.flatMap((condition) => Array.from({ length: runs }, (_, run) => ({ condition, run: run + offset })))
    const results = await Promise.all(jobs.map(async ({ condition, run }) => ({ task, language, condition, run, ...(await runAgent(task, histories[condition], prompts[prompts.length - 1])) })))
    rows.push(...results)
    for (const r of results) process.stderr.write(`${task} ${r.condition} #${r.run + 1}: ${r.success ? 'PASS' : 'fail'} (${r.passed}/${r.passed + r.failed} tests, ${r.turns} turns, $${r.costUsd.toFixed(3)})\n`)
  }
} catch (err) {
  if (!(err instanceof SpendLimitError)) throw err
  // Tasks that finished before the limit are kept; the task in progress is lost.
  console.error(`Stopped: ${err.message}. Writing the ${rows.length} runs from tasks that finished.`)
}

const key = (r) => `${r.task}|${r.condition}|${r.run}`
const ran = new Set(rows.map(key))
const kept = args.merge ? JSON.parse(readFileSync(args.merge, 'utf8')).rows.filter((r) => !ran.has(key(r))) : []
const allRows = [...kept, ...rows]
printTable(allRows, agentModel)
console.log(`\nAPI usage this run: ${spend.summary()}`)
if (args.out) {
  writeFileSync(args.out, `${JSON.stringify({ agentModel, budget: BUDGET, maxTurns, rows: allRows }, null, 1)}\n`)
  console.log(`Wrote every run to ${args.out}${kept.length ? ` (${kept.length} rows kept from ${args.merge})` : ''}`)
}
