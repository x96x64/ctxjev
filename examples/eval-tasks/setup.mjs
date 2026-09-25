#!/usr/bin/env node
// Materializes a task's repo: copies template/ to <dest> and replays task.json's commit history
// with fixed dates, so `git log` reads the same in every recording and every eval run.
//
// Format 1 (every task written before Round 2): only the first commit has content; the later ones
// are empty, so `git show` on them contradicts any probe that says "this commit introduced X".
// Recorded sessions and saved results depend on these exact repos, so format 1 stays as it is.
//
// Format 2 (`"format": 2` in task.json, required for new tasks): every commit after the first
// carries a real change, given as a unified diff (`"diff": "history/<file>.diff"`, relative to the
// task directory, written with `git diff`). The template is the state after the last commit, so
// setup applies the diffs in reverse to get the first commit's tree, then forward one commit at a
// time, and checks it ended exactly at the template.
//
// Usage: node examples/eval-tasks/setup.mjs <task> <dest>
//        CTXJEV_TASKS_DIR=<dir> picks the directory tasks are read from (the harness self-test).
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [task, dest] = process.argv.slice(2)
if (!task || !dest) {
  console.error('usage: setup.mjs <task> <dest>')
  process.exit(1)
}
const tasksDir = resolve(process.env.CTXJEV_TASKS_DIR ?? dirname(fileURLToPath(import.meta.url)))
const taskDir = join(tasksDir, task)
const { history, format = 1 } = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8'))
if (format !== 1 && format !== 2) throw new Error(`${task}: unknown task format ${format}`)
if (format === 2) {
  history.slice(1).forEach((commit, i) => {
    if (!commit.diff) throw new Error(`${task}: history[${i + 1}] ("${commit.message}") has no diff; format 2 gives every commit after the first a real change`)
    if (!existsSync(join(taskDir, commit.diff))) throw new Error(`${task}: history[${i + 1}] names ${commit.diff}, which doesn't exist`)
  })
}

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
cpSync(join(taskDir, 'template'), dest, { recursive: true })

const git = (args, date) =>
  execFileSync('git', args, {
    cwd: dest,
    stdio: 'pipe',
    env: {
      PATH: process.env.PATH,
      HOME: dest,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: date ? history.find((h) => h.date === date)?.author ?? 'Dev' : 'Dev',
      GIT_AUTHOR_EMAIL: 'dev@example.com',
      GIT_COMMITTER_NAME: 'Dev',
      GIT_COMMITTER_EMAIL: 'dev@example.com',
      ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
    },
  })

git(['init', '-q', '-b', 'main'])
const [first, ...rest] = history

if (format === 1) {
  git(['add', '-A'])
  git(['commit', '-q', '-m', first.message], first.date)
  for (const commit of rest) git(['commit', '-q', '--allow-empty', '-m', commit.message], commit.date)
} else {
  // Back to the first commit's tree: undo the later commits, newest first.
  for (const commit of [...rest].reverse()) git(['apply', '-R', '--whitespace=nowarn', join(taskDir, commit.diff)])
  git(['add', '-A'])
  git(['commit', '-q', '-m', first.message], first.date)
  for (const commit of rest) {
    git(['apply', '--whitespace=nowarn', join(taskDir, commit.diff)])
    git(['add', '-A'])
    // No --allow-empty: a diff that changes nothing fails here instead of making an empty commit.
    git(['commit', '-q', '-m', commit.message], commit.date)
  }
  const drift = differences(join(taskDir, 'template'), dest)
  if (drift.length > 0) throw new Error(`${task}: replaying history didn't end at template/: ${drift.slice(0, 5).join(', ')}`)
}

/** Files that differ between two trees, ignoring .git. */
function differences(a, b) {
  const files = (root) =>
    readdirSync(root, { recursive: true })
      .map(String)
      .filter((p) => !p.split(/[\\/]/).includes('.git') && statSync(join(root, p)).isFile())
      .sort()
  const [fa, fb] = [files(a), files(b)]
  const all = [...new Set([...fa, ...fb])]
  return all.filter((p) => !fa.includes(p) || !fb.includes(p) || !readFileSync(join(a, p)).equals(readFileSync(join(b, p)))).map((p) => relative('.', p))
}
