#!/usr/bin/env node
/**
 * Outcome eval: does a model still know what it needs after pruning?
 *
 * For each held-out session (examples/eval-sessions), the conversation is squeezed into a token
 * budget with pruneMessages({ targetTokens }), ranked by Jev, by keyword overlap, or newest-first
 * (plain truncation). Claude Haiku 4.5 then answers each probe's question from what's left, and
 * Claude Sonnet 5 judges whether the answer conveys the probe's fact. Two reference conditions
 * bracket it: `full` (nothing removed) and `goal-only` (just the task, which measures guessing).
 *
 * Every question for one condition shares that condition's conversation, so it's cached: the first
 * question writes it, the rest read it at a tenth of the price.
 *
 * Not part of the release gate: it needs ANTHROPIC_API_KEY (and TYPESAFE_API_KEY for the Jev
 * condition), costs real money (printed at the end), and a model's answers vary. By hand:
 *
 *   node eval/outcome.mjs --max-usd 3 [--runs N] [--split dev|holdout|all] [--session <name prefix>] [--out results.json] [--merge previous.json]
 *   node eval/outcome.mjs --report eval/results/outcome.json   (re-print a saved table, no API calls)
 *
 * --merge keeps the previous results for every session this run didn't cover.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import { inSplit, parseSplit, sessionSplit } from './split.mjs'
import { ANSWER_MODEL, JUDGE_MODEL, SpendLimitError, bootstrap, createLimiter, createQA, createSpend, pruneTo, rankings, rateDifference, successRate } from './lib.mjs'

const BUDGETS = [0.25, 0.5]

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '1' },
    out: { type: 'string' },
    merge: { type: 'string' },
    session: { type: 'string' },
    split: { type: 'string', default: 'all' },
    report: { type: 'string' },
    'max-usd': { type: 'string' },
  },
})

function printTable(rows, header) {
  const rate = (rs) => (rs.length === 0 ? NaN : rs.filter((r) => r.correct).length / rs.length)
  const pct = (x) => (Number.isNaN(x) ? '   -  ' : `${(x * 100).toFixed(1)}%`.padStart(6))
  const labelOf = (strategy, budget) => (budget === 1 || budget === 0 ? strategy : `${strategy} @${budget * 100}%`)
  const cells = [...new Map(rows.map((r) => [labelOf(r.strategy, r.budget), [r.strategy, r.budget]])).entries()]
  const columns = [
    ['all', () => true],
    ['written', (r) => !r.recorded],
    ['recorded', (r) => r.recorded],
    ['en', (r) => r.language === 'en'],
    ['ja', (r) => r.language === 'ja'],
  ]
  const interval = (rs) => {
    const [lo, hi] = bootstrap(rs, (r) => r.session, successRate('correct'))
    return `[${(lo * 100).toFixed(0)}, ${(hi * 100).toFixed(0)}]`
  }
  console.log(`\n${header}\n`)
  console.log(`  ${'condition'.padEnd(18)}${columns.map(([name]) => name.padStart(10)).join('')}${'95% CI (all)'.padStart(15)}`)
  for (const [label, [strategy, budget]] of cells) {
    const rs = rows.filter((r) => r.strategy === strategy && r.budget === budget)
    console.log(`  ${label.padEnd(18)}${columns.map(([, keep]) => pct(rate(rs.filter(keep))).padStart(10)).join('')}${interval(rs).padStart(15)}`)
  }
  console.log('\n  Jev minus each alternative, same sessions resampled together (percentage points, 95% CI):')
  for (const budget of [...new Set(rows.map((r) => r.budget))].filter((b) => b > 0 && b < 1)) {
    for (const other of ['recency', 'keywords']) {
      const both = rows.filter((r) => r.budget === budget && (r.strategy === 'jev' || r.strategy === other))
      if (!both.some((r) => r.strategy === other)) continue
      const diff = rateDifference('correct', (r) => r.strategy === 'jev', (r) => r.strategy === other)
      const [lo, hi] = bootstrap(both, (r) => r.session, diff)
      const signed = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}`
      console.log(`    @${budget * 100}% jev − ${other.padEnd(9)}${signed(diff(both)).padStart(5)}   [${signed(lo)}, ${signed(hi)}]`)
    }
  }
}

const describe = (rows, answerModel, judgeModel) => {
  const sessions = new Set(rows.map((r) => r.session)).size
  const questions = new Set(rows.map((r) => `${r.session}|${r.question}`)).size
  return `Probe questions answered correctly (${answerModel}, judged by ${judgeModel}; ${sessions} sessions, ${questions} questions)`
}

if (args.report) {
  const saved = JSON.parse(readFileSync(args.report, 'utf8'))
  printTable(saved.rows, describe(saved.rows, saved.answerModel, saved.judgeModel))
  process.exit(0)
}

const runs = Number(args.runs)
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a whole number of at least 1, got ${args.runs}`)
const maxUsd = Number(args['max-usd'])
if (!(maxUsd > 0)) throw new Error('--max-usd is required: the most this run may spend, in dollars')
for (const key of ['ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY']) {
  if (!process.env[key]) throw new Error(`${key} is not set`)
}

const client = new Anthropic()
const spend = createSpend(maxUsd)
const limit = createLimiter(5)
const sessionsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/eval-sessions')
const sessions = readdirSync(sessionsDir)
  .filter((f) => f.endsWith('.json') && inSplit(sessionSplit(f), parseSplit(args.split)) && (!args.session || args.session.split(',').some((p) => f.startsWith(p))))
  .map((f) => ({ name: f, ...JSON.parse(readFileSync(join(sessionsDir, f), 'utf8')) }))

const { answer, judge } = createQA({ client, spend, limit })

async function conditionsFor(session) {
  const ranked = await rankings(session.messages, session.goal)
  const conditions = [
    { strategy: 'full', budget: 1, messages: session.messages },
    { strategy: 'goal-only', budget: 0, messages: [session.messages[0]] },
  ]
  for (const budget of BUDGETS) {
    for (const strategy of ['jev', 'keywords', 'recency']) {
      conditions.push({ strategy, budget, messages: await pruneTo(session.messages, session.goal, ranked[strategy], strategy, budget) })
    }
  }
  return conditions
}

// The first question for a condition writes its cache; the rest follow once it's there.
async function gradeCondition(session, condition, run) {
  const grade = async (probe) => {
    const reply = await answer(condition.messages, probe.question)
    const correct = await judge(probe, reply)
    return { run, session: session.name, recorded: Boolean(session.recorded), language: session.language, strategy: condition.strategy, budget: condition.budget, question: probe.question, fact: probe.fact, reply, correct }
  }
  const [first, ...rest] = session.probes
  return [await grade(first), ...(await Promise.all(rest.map(grade)))]
}

const rows = []
try {
  for (let run = 0; run < runs; run++) {
    for (const session of sessions) {
      const conditions = await conditionsFor(session)
      for (const graded of await Promise.all(conditions.map((c) => gradeCondition(session, c, run)))) rows.push(...graded)
      process.stderr.write(`run ${run + 1}/${runs}: ${session.name} done — $${spend.total.toFixed(2)} so far\n`)
    }
  }
} catch (err) {
  console.error(`Stopped: ${err instanceof SpendLimitError ? err.message : err.stack}. Nothing is written for a partial run.`)
  console.error(`API usage before stopping: ${spend.summary()}`)
  process.exit(1)
}

const ran = new Set(rows.map((r) => r.session))
const kept = args.merge ? JSON.parse(readFileSync(args.merge, 'utf8')).rows.filter((r) => !ran.has(r.session)) : []
const allRows = [...kept, ...rows]
printTable(allRows, describe(allRows, ANSWER_MODEL, JUDGE_MODEL))
console.log(`\nAPI usage this run: ${spend.summary()}`)

if (args.out) {
  writeFileSync(args.out, `${JSON.stringify({ answerModel: ANSWER_MODEL, judgeModel: JUDGE_MODEL, runs, rows: allRows }, null, 1)}\n`)
  console.log(`Wrote every answer and verdict to ${args.out}${kept.length ? ` (${kept.length} rows kept from ${args.merge})` : ''}`)
}
