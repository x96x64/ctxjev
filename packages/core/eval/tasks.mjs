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
 *   node eval/tasks.mjs --max-usd 6 [--runs N] [--task <prefix>] [--conditions full,jev] [--out results.json] [--merge previous.json]
 *   node eval/tasks.mjs --report eval/results/tasks.json
 *   node eval/tasks.mjs --selftest   (no API calls: solution applied through the tools passes, untouched fails)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, globSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import { ANSWER_MODEL, SpendLimitError, costOf, createLimiter, createSpend, pruneTo, rankings, withCacheBreakpoint } from './lib.mjs'

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
const OUTPUT_LIMIT = 30_000

const examples = join(dirname(fileURLToPath(import.meta.url)), '../../../examples')
const tasksDir = join(examples, 'eval-tasks')

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '1' },
    task: { type: 'string' },
    conditions: { type: 'string' },
    out: { type: 'string' },
    merge: { type: 'string' },
    report: { type: 'string' },
    selftest: { type: 'boolean' },
    'max-usd': { type: 'string' },
    'max-turns': { type: 'string', default: '25' },
  },
})

// --- tools, run against a temporary copy of the task's repo ------------------------------------

const TOOLS = [
  { name: 'Bash', description: 'Run a shell command in the repository.', input_schema: { type: 'object', properties: { command: { type: 'string' }, description: { type: 'string' } }, required: ['command'] } },
  { name: 'Read', description: 'Read a file; lines are numbered.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['file_path'] } },
  { name: 'Edit', description: 'Replace old_string with new_string in a file. old_string must match exactly once unless replace_all is set.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'Write', description: 'Write a whole file.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  { name: 'Grep', description: 'Search file contents with a regular expression.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] }, '-i': { type: 'boolean' } }, required: ['pattern'] } },
  { name: 'Glob', description: 'List files matching a glob pattern.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
]

function workspaceTools(task, repo) {
  const virtualRoot = `/workspace/${task}`
  const toReal = (text) => text.split(virtualRoot).join(repo)
  const toVirtual = (text) => text.split(repo).join(virtualRoot)
  const clip = (text) => (text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n... (output truncated)` : text)
  const env = { PATH: process.env.PATH, HOME: repo, LANG: 'en_US.UTF-8', GIT_CONFIG_NOSYSTEM: '1' }

  function inRepo(path) {
    const real = resolve(repo, toReal(path ?? '.'))
    const rel = relative(repo, real)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${path} is outside the repository`)
    return real
  }

  const handlers = {
    Bash({ command }) {
      const r = spawnSync('bash', ['-c', toReal(command)], { cwd: repo, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
      if (r.error?.code === 'ETIMEDOUT') throw new Error(`command timed out after 60s\n${out}`)
      if (r.status !== 0) throw new Error(`Exit code ${r.status}\n${out}`)
      return out || '(no output)'
    },
    Read({ file_path, offset = 1, limit = 2000 }) {
      const lines = readFileSync(inRepo(file_path), 'utf8').split('\n')
      return lines.slice(offset - 1, offset - 1 + limit).map((line, i) => `${String(offset + i).padStart(6)}\t${line}`).join('\n')
    },
    Edit({ file_path, old_string, new_string, replace_all = false }) {
      const path = inRepo(file_path)
      const text = readFileSync(path, 'utf8')
      const count = old_string === '' ? 0 : text.split(old_string).length - 1
      if (count === 0) throw new Error('old_string not found in the file')
      if (count > 1 && !replace_all) throw new Error(`old_string matches ${count} times; add context or set replace_all`)
      writeFileSync(path, replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, () => new_string))
      return `The file ${file_path} has been updated.`
    },
    Write({ file_path, content }) {
      writeFileSync(inRepo(file_path), content)
      return `File written: ${file_path}`
    },
    Grep({ pattern, path, glob, output_mode = 'files_with_matches', ...flags }) {
      const target = relative(repo, inRepo(path)) || '.'
      const mode = { content: ['-n'], files_with_matches: ['-l'], count: ['-c'] }[output_mode] ?? ['-l']
      const r = spawnSync('grep', ['-rE', ...mode, ...(flags['-i'] ? ['-i'] : []), ...(glob ? [`--include=${glob}`] : []), '--exclude-dir=.git', '--exclude-dir=test-hidden', '-e', pattern, target], { cwd: repo, env, encoding: 'utf8' })
      if (r.status === 2) throw new Error(r.stderr.trim())
      return r.stdout.trim() || 'No matches found'
    },
    Glob({ pattern, path }) {
      const base = inRepo(path)
      const found = globSync(pattern, { cwd: base }).filter((p) => !p.startsWith('.git/'))
      return found.length ? found.map((p) => relative(repo, join(base, p))).join('\n') : 'No files found'
    },
  }

  return (name, input) => {
    try {
      if (!handlers[name]) throw new Error(`No such tool: ${name}`)
      return { content: clip(toVirtual(String(handlers[name](input)))) }
    } catch (err) {
      return { content: clip(toVirtual(err.message)), is_error: true }
    }
  }
}

function freshRepo(task) {
  const work = mkdtempSync(join(tmpdir(), `ctxjev-eval-${task}-`))
  const repo = join(work, 'repo')
  execFileSync('node', [join(tasksDir, 'setup.mjs'), task, repo], { stdio: 'pipe' })
  return { work, repo }
}

function grade(task, repo) {
  cpSync(join(tasksDir, task, 'hidden'), join(repo, 'test-hidden'), { recursive: true })
  const r = spawnSync('node', ['--test', '--test-reporter=tap', 'test-hidden/*.test.js'], { cwd: repo, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 120_000 })
  const count = (key) => Number(new RegExp(`^# ${key} (\\d+)`, 'm').exec(r.stdout)?.[1] ?? 0)
  const failedTests = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1])
  return { success: r.status === 0, passed: count('pass'), failed: count('fail'), failedTests }
}

// --- report ------------------------------------------------------------------------------------

function printTable(rows) {
  const conditions = [...new Set(rows.map((r) => r.condition))].sort((a, b) => ALL_CONDITIONS.indexOf(a.split('+')[0]) - ALL_CONDITIONS.indexOf(b.split('+')[0]) || a.localeCompare(b))
  const pct = (xs) => (xs.length === 0 ? '   -  ' : `${((xs.filter((r) => r.success).length / xs.length) * 100).toFixed(0)}%`.padStart(6))
  const tasks = [...new Set(rows.map((r) => r.task))]
  console.log(`\nHidden acceptance tests passed (${ANSWER_MODEL} as the agent; history pruned to ${BUDGET * 100}% except full / goal-only)\n`)
  console.log(`  ${'condition'.padEnd(20)}${'all'.padStart(8)}${'en'.padStart(8)}${'ja'.padStart(8)}${'turns'.padStart(8)}${'$/run'.padStart(8)}   ${tasks.map((t) => t.slice(0, 10).padStart(11)).join('')}`)
  for (const c of conditions) {
    const rs = rows.filter((r) => r.condition === c)
    const mean = (f) => rs.reduce((s, r) => s + f(r), 0) / rs.length
    const costs = rs.filter((r) => typeof r.costUsd === 'number')
    console.log(
      `  ${c.padEnd(20)}${pct(rs).padStart(8)}${pct(rs.filter((r) => r.language === 'en')).padStart(8)}${pct(rs.filter((r) => r.language === 'ja')).padStart(8)}` +
        `${mean((r) => r.turns).toFixed(1).padStart(8)}${(costs.length ? `$${(costs.reduce((s, r) => s + r.costUsd, 0) / costs.length).toFixed(3)}` : '-').padStart(8)}   ${tasks.map((t) => pct(rs.filter((r) => r.task === t)).padStart(11)).join('')}`,
    )
  }
}

if (args.report) {
  printTable(JSON.parse(readFileSync(args.report, 'utf8')).rows)
  process.exit(0)
}

const taskNames = readdirSync(tasksDir).filter((d) => statSync(join(tasksDir, d)).isDirectory() && (!args.task || d.startsWith(args.task)))

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

async function runAgent(task, history, fixPrompt) {
  const { work, repo } = freshRepo(task)
  const runTool = workspaceTools(task, repo)
  const last = history[history.length - 1]
  const messages =
    last.role === 'user'
      ? [...history.slice(0, -1), { role: 'user', content: [...(typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content), { type: 'text', text: fixPrompt }] }]
      : [...history, { role: 'user', content: fixPrompt }]
  let costUsd = 0
  let turns = 0
  let toolCalls = 0
  let stoppedBy = 'max_turns'
  let finalText = ''
  try {
    while (turns < maxTurns) {
      spend.check()
      turns++
      const response = await limit(() =>
        client.messages.create({
          model: ANSWER_MODEL,
          max_tokens: 8000,
          system: `You are a coding agent working in the repository at /workspace/${task}. Use the tools to do what the user asks, then reply with a short summary and stop.`,
          tools: TOOLS,
          messages: withCacheBreakpoint(messages),
        }),
      )
      spend.record(ANSWER_MODEL, response.usage)
      costUsd += costOf(ANSWER_MODEL, response.usage)
      messages.push({ role: 'assistant', content: response.content })
      finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').slice(0, 2000)
      const uses = response.content.filter((b) => b.type === 'tool_use')
      if (response.stop_reason !== 'tool_use' || uses.length === 0) {
        stoppedBy = response.stop_reason
        break
      }
      toolCalls += uses.length
      messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, ...runTool(u.name, u.input) })) })
    }
    return { ...grade(task, repo), turns, toolCalls, stoppedBy, finalText, costUsd }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

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
    const jobs = conditions.flatMap((condition) => Array.from({ length: runs }, (_, run) => ({ condition, run })))
    const results = await Promise.all(jobs.map(async ({ condition, run }) => ({ task, language, condition, run, ...(await runAgent(task, histories[condition], prompts[prompts.length - 1])) })))
    rows.push(...results)
    for (const r of results) process.stderr.write(`${task} ${r.condition} #${r.run + 1}: ${r.success ? 'PASS' : 'fail'} (${r.passed}/${r.passed + r.failed} tests, ${r.turns} turns, $${r.costUsd.toFixed(3)})\n`)
  }
} catch (err) {
  console.error(`Stopped: ${err instanceof SpendLimitError ? err.message : err.stack}. Nothing is written for a partial run.`)
  console.error(`API usage before stopping: ${spend.summary()}`)
  process.exit(1)
}

const ran = new Set(rows.map((r) => `${r.task}|${r.condition}`))
const kept = args.merge ? JSON.parse(readFileSync(args.merge, 'utf8')).rows.filter((r) => !ran.has(`${r.task}|${r.condition}`)) : []
const allRows = [...kept, ...rows]
printTable(allRows)
console.log(`\nAPI usage this run: ${spend.summary()}`)
if (args.out) {
  writeFileSync(args.out, `${JSON.stringify({ agentModel: ANSWER_MODEL, budget: BUDGET, maxTurns, rows: allRows }, null, 1)}\n`)
  console.log(`Wrote every run to ${args.out}${kept.length ? ` (${kept.length} rows kept from ${args.merge})` : ''}`)
}
