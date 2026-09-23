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
 * Not part of the release gate: it needs ANTHROPIC_API_KEY, costs real money (about $1 a run,
 * printed at the end), and a model's answers vary. Run it by hand when scoring changes:
 *
 *   node eval/outcome.mjs [--runs N] [--out results.json] [--session <name prefix>]   (from packages/core, after `pnpm build`)
 *   node eval/outcome.mjs --report eval/results/outcome.json   (re-print a saved run's table, no API calls)
 *
 * Needs TYPESAFE_API_KEY too, for the Jev condition.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_POLICY, messagesToEntries, pruneMessages, scoreEntries } from '../dist/index.js'

const ANSWER_MODEL = 'claude-haiku-4-5'
const JUDGE_MODEL = 'claude-sonnet-5'
// $ per million tokens (input, output), from the Claude API price list.
const PRICES = { [ANSWER_MODEL]: [1, 5], [JUDGE_MODEL]: [2, 10] }
const BUDGETS = [0.25, 0.5]
const CONCURRENCY = 5

const { values: args } = parseArgs({ options: { runs: { type: 'string', default: '1' }, out: { type: 'string' }, session: { type: 'string' }, report: { type: 'string' } } })
const runs = Number(args.runs)
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a whole number of at least 1, got ${args.runs}`)

function printTable(rows, header) {
  const rate = (rs) => (rs.length === 0 ? NaN : rs.filter((r) => r.correct).length / rs.length)
  const pct = (x) => (Number.isNaN(x) ? '   -  ' : `${(x * 100).toFixed(1)}%`.padStart(6))
  const labelOf = (strategy, budget) => (budget === 1 || budget === 0 ? strategy : `${strategy} @${budget * 100}%`)
  const cells = [...new Map(rows.map((r) => [labelOf(r.strategy, r.budget), [r.strategy, r.budget]])).entries()]
  console.log(`\n${header}\n`)
  console.log(`  ${'condition'.padEnd(18)}${'all'.padStart(8)}${'en'.padStart(8)}${'ja'.padStart(8)}`)
  for (const [label, [strategy, budget]] of cells) {
    const rs = rows.filter((r) => r.strategy === strategy && r.budget === budget)
    console.log(`  ${label.padEnd(18)}${pct(rate(rs)).padStart(8)}${pct(rate(rs.filter((r) => r.language === 'en'))).padStart(8)}${pct(rate(rs.filter((r) => r.language === 'ja'))).padStart(8)}`)
  }
}

if (args.report) {
  const saved = JSON.parse(readFileSync(args.report, 'utf8'))
  const sessionCount = new Set(saved.rows.map((r) => r.session)).size
  printTable(saved.rows, `Probe questions answered correctly (${saved.answerModel}, judged by ${saved.judgeModel}; ${sessionCount} sessions, ${saved.runs} run(s))`)
  process.exit(0)
}

for (const key of ['ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY']) {
  if (!process.env[key]) throw new Error(`${key} is not set`)
}

const client = new Anthropic()
const sessionsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/eval-sessions')
const sessions = readdirSync(sessionsDir)
  .filter((f) => f.endsWith('.json') && (!args.session || f.startsWith(args.session)))
  .map((f) => ({ name: f, ...JSON.parse(readFileSync(join(sessionsDir, f), 'utf8')) }))

const usage = {}
function record(model, u) {
  usage[model] ??= { input: 0, output: 0 }
  usage[model].input += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  usage[model].output += u.output_tokens
}

async function pool(items, fn) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i])
    }),
  )
  return results
}

// Histories carry tool_use blocks, so the request declares those tools, but never lets the model call one.
function toolsFor(messages) {
  const names = new Set()
  for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') names.add(b.name)
  return [...names].map((name) => ({ name, description: `The ${name} tool used earlier in this session.`, input_schema: { type: 'object', additionalProperties: true } }))
}

const firstText = (message) => message.content.find((b) => b.type === 'text')?.text?.trim() ?? ''

async function answer(history, question) {
  const tools = toolsFor(history)
  const response = await client.messages.create({
    model: ANSWER_MODEL,
    max_tokens: 400,
    temperature: 0,
    system:
      'The conversation above is a coding session. The last message is a question about it, not a request to continue the work: ' +
      'do not propose next steps or ask to look at code. Answer using only what the conversation shows, in one or two sentences, ' +
      'in the language of the question. If the conversation does not say, reply exactly "NOT IN CONTEXT".',
    ...(tools.length > 0 && { tools, tool_choice: { type: 'none' } }),
    messages: [...history, { role: 'user', content: question }],
  })
  record(ANSWER_MODEL, response.usage)
  return firstText(response)
}

async function judge(probe, reply) {
  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content:
          `Question: ${probe.question}\nReference fact: ${probe.fact}\nAnswer to grade: ${reply}\n\n` +
          'Does the answer state the reference fact, including its key specifics, without contradicting it? ' +
          'An answer that says the information is missing is NO. Reply with exactly YES or NO.',
      },
    ],
  })
  record(JUDGE_MODEL, response.usage)
  return /^\s*YES\b/i.test(firstText(response))
}

async function pruneTo(session, scoreOf, recencyWeight, budget) {
  const total = messagesToEntries(session.messages).reduce((sum, e) => sum + e.sourceTokens, 0)
  const { messages } = await pruneMessages(session.messages, session.goal, {
    scorer: async (_goal, entries) => entries.map((e) => scoreOf(e.id)),
    policy: { dropBelow: 0, summarizeBelow: 0, recencyWeight },
    targetTokens: Math.floor(total * budget),
  })
  return messages
}

async function conditionsFor(session) {
  const entries = messagesToEntries(session.messages)
  const jev = new Map((await scoreEntries(entries, session.goal, 0, { scorer: 'jev' })).map((s) => [s.entryId, s.relevance]))
  const local = new Map((await scoreEntries(entries, session.goal, 0, { scorer: 'local' })).map((s) => [s.entryId, s.relevance]))
  const order = new Map(entries.map((e, i) => [e.id, i / (entries.length - 1)]))
  const conditions = [
    { strategy: 'full', budget: 1, messages: session.messages },
    { strategy: 'goal-only', budget: 0, messages: [session.messages[0]] },
  ]
  for (const budget of BUDGETS) {
    conditions.push({ strategy: 'jev', budget, messages: await pruneTo(session, (id) => jev.get(id), DEFAULT_POLICY.recencyWeight, budget) })
    conditions.push({ strategy: 'keywords', budget, messages: await pruneTo(session, (id) => local.get(id), DEFAULT_POLICY.recencyWeight, budget) })
    conditions.push({ strategy: 'recency', budget, messages: await pruneTo(session, (id) => order.get(id), 0, budget) })
  }
  return conditions
}

const rows = []
for (let run = 0; run < runs; run++) {
  for (const session of sessions) {
    const conditions = await conditionsFor(session)
    const jobs = conditions.flatMap((c) => session.probes.map((probe) => ({ c, probe })))
    const graded = await pool(jobs, async ({ c, probe }) => {
      const reply = await answer(c.messages, probe.question)
      return { run, session: session.name, language: session.language, strategy: c.strategy, budget: c.budget, question: probe.question, fact: probe.fact, reply, correct: await judge(probe, reply) }
    })
    rows.push(...graded)
    process.stderr.write(`run ${run + 1}/${runs}: ${session.name} done\n`)
  }
}

printTable(rows, `Probe questions answered correctly (${ANSWER_MODEL}, judged by ${JUDGE_MODEL}; ${sessions.length} sessions, ${runs} run(s))`)

const cost = Object.entries(usage).reduce((sum, [model, u]) => sum + (u.input * PRICES[model][0] + u.output * PRICES[model][1]) / 1e6, 0)
console.log(`\nAPI usage: ${Object.entries(usage).map(([m, u]) => `${m} ${u.input.toLocaleString()} in / ${u.output.toLocaleString()} out`).join(', ')} — about $${cost.toFixed(2)}`)

if (args.out) {
  writeFileSync(args.out, `${JSON.stringify({ answerModel: ANSWER_MODEL, judgeModel: JUDGE_MODEL, runs, rows }, null, 1)}\n`)
  console.log(`Wrote every answer and verdict to ${args.out}`)
}
