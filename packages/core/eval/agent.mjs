// Shared by tasks.mjs and plugin.mjs: run an agent on a task repo and grade it with the hidden tests.
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { costOf, withCacheBreakpoint } from './lib.mjs'

const OUTPUT_LIMIT = 30_000
export const tasksDir = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/eval-tasks')

// --- tools, run against a temporary copy of the task's repo ------------------------------------

export const TOOLS = [
  { name: 'Bash', description: 'Run a shell command in the repository.', input_schema: { type: 'object', properties: { command: { type: 'string' }, description: { type: 'string' } }, required: ['command'] } },
  { name: 'Read', description: 'Read a file; lines are numbered.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['file_path'] } },
  { name: 'Edit', description: 'Replace old_string with new_string in a file. old_string must match exactly once unless replace_all is set.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'Write', description: 'Write a whole file.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  { name: 'Grep', description: 'Search file contents with a regular expression.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] }, '-i': { type: 'boolean' } }, required: ['pattern'] } },
  { name: 'Glob', description: 'List files matching a glob pattern.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
]

export function workspaceTools(task, repo) {
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

export function freshRepo(task) {
  const work = mkdtempSync(join(tmpdir(), `ctxjev-eval-${task}-`))
  const repo = join(work, 'repo')
  execFileSync('node', [join(tasksDir, 'setup.mjs'), task, repo], { stdio: 'pipe' })
  return { work, repo }
}

export function grade(task, repo) {
  cpSync(join(tasksDir, task, 'hidden'), join(repo, 'test-hidden'), { recursive: true })
  const r = spawnSync('node', ['--test', '--test-reporter=tap', 'test-hidden/*.test.js'], { cwd: repo, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 120_000 })
  const count = (key) => Number(new RegExp(`^# ${key} (\\d+)`, 'm').exec(r.stdout)?.[1] ?? 0)
  const failedTests = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1])
  return { success: r.status === 0, passed: count('pass'), failed: count('fail'), failedTests }
}

/** An agent loop bound to one client, spend tracker, limiter, and model. */
export function createAgentRunner({ client, spend, limit, model, maxTurns }) {
  return async function runAgent(task, history, fixPrompt) {
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
            model: model,
            max_tokens: 8000,
            system: `You are a coding agent working in the repository at /workspace/${task}. Use the tools to do what the user asks, then reply with a short summary and stop.`,
            tools: TOOLS,
            messages: withCacheBreakpoint(messages),
          }),
        )
        spend.record(model, response.usage)
        costUsd += costOf(model, response.usage)
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
}
