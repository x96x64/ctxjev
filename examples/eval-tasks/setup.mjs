#!/usr/bin/env node
// Materializes a task's repo: copies template/ to <dest> and replays task.json's commit history
// with fixed dates, so `git log` reads the same in every recording and every eval run.
// Usage: node examples/eval-tasks/setup.mjs <task> <dest>
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [task, dest] = process.argv.slice(2)
if (!task || !dest) {
  console.error('usage: setup.mjs <task> <dest>')
  process.exit(1)
}
const taskDir = join(dirname(fileURLToPath(import.meta.url)), task)
const { history } = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8'))

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
git(['add', '-A'])
git(['commit', '-q', '-m', first.message], first.date)
for (const commit of rest) git(['commit', '-q', '--allow-empty', '-m', commit.message], commit.date)
