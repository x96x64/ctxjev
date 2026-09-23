#!/usr/bin/env node
// Records a real Claude Code session on one task, for examples/eval-sessions/recorded-*.json.
//
// Runs `claude -p` with a clean environment, so it authenticates the way an interactive `claude`
// does (a Claude subscription login) rather than with ANTHROPIC_API_KEY, and without the calling
// session's hooks, plugins, or MCP servers. The goal and the first two follow-ups are
// investigation only (no Edit/Write tool); the last one is the fix. Prints where the transcript
// was copied.
//
// Usage: node examples/eval-tasks/record.mjs <task> <workdir>
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [task, workdir] = process.argv.slice(2)
if (!task || !workdir) {
  console.error('usage: record.mjs <task> <workdir>')
  process.exit(1)
}
const root = dirname(fileURLToPath(import.meta.url))
const { goal, prompts } = JSON.parse(readFileSync(join(root, task, 'task.json'), 'utf8'))
mkdirSync(workdir, { recursive: true })
const repo = join(workdir, task)
execFileSync('node', [join(root, 'setup.mjs'), task, repo], { stdio: 'inherit' })

const sessionId = randomUUID()
const READ_ONLY = ['Bash', 'Read', 'Grep', 'Glob']
const DISALLOWED = ['TodoWrite', 'Task', 'Agent', 'WebFetch', 'WebSearch', 'NotebookEdit', 'MultiEdit']
const cleanEnv = { HOME: homedir(), PATH: process.env.PATH, USER: process.env.USER, LANG: 'en_US.UTF-8' }

const turns = [goal, ...prompts]
turns.forEach((prompt, i) => {
  const last = i === turns.length - 1
  const allowed = last ? [...READ_ONLY, 'Edit', 'Write'] : READ_ONLY
  const disallowed = last ? DISALLOWED : [...DISALLOWED, 'Edit', 'Write']
  const args = [
    '-p', prompt,
    ...(i === 0 ? ['--session-id', sessionId] : ['--resume', sessionId]),
    '--model', 'sonnet',
    '--output-format', 'json',
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
    '--allowedTools', ...allowed,
    '--disallowedTools', ...disallowed,
  ]
  process.stderr.write(`[${task}] turn ${i + 1}/${turns.length}\n`)
  const out = execFileSync('claude', args, { cwd: repo, env: cleanEnv, maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 })
  writeFileSync(join(workdir, `${task}.turn-${i + 1}.json`), out)
  const result = JSON.parse(out.toString())
  if (result.is_error) throw new Error(`turn ${i + 1} failed: ${result.result}`)
})

const projects = join(homedir(), '.claude', 'projects')
const found = readdirSync(projects).map((d) => join(projects, d, `${sessionId}.jsonl`)).find((p) => existsSync(p))
if (!found) throw new Error(`transcript for session ${sessionId} not found under ${projects}`)
const dest = join(workdir, `${task}.jsonl`)
copyFileSync(found, dest)
console.log(JSON.stringify({ task, sessionId, transcript: dest, repo }))
