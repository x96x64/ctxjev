#!/usr/bin/env node
// Checks every task without calling any model: the template's own tests pass, the hidden
// acceptance tests fail on the untouched template, and pass once solution/ is applied. The hidden
// tests see a pristine copy of the task at CTXJEV_PRISTINE_REPO, as they do in the eval harness.
// A format-2 task (see setup.mjs) must also replay its history with real diffs, and its hidden
// tests must check "left unchanged" against that copy, never with `git diff`, which an agent gets
// past by committing.
// Usage: node examples/eval-tasks/verify.mjs   (CTXJEV_TASKS_DIR=<dir> for another task directory)
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// `node --test <glob>` expands the glob itself only from Node 21 on; see .nvmrc.
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`verify.mjs needs Node 22 or later (see .nvmrc); this is Node ${process.versions.node}.`)
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.env.CTXJEV_TASKS_DIR ?? here)
const tasks = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory())

function passes(cwd, args, env = {}) {
  try {
    execFileSync('node', ['--test', ...args], { cwd, stdio: 'pipe', env: { PATH: process.env.PATH, ...env }, timeout: 60_000 })
    return true
  } catch {
    return false
  }
}

const setUp = (task, dest) => execFileSync('node', [join(here, 'setup.mjs'), task, dest], { stdio: 'pipe', env: { ...process.env, CTXJEV_TASKS_DIR: root } })

// A "must not change" check a committed change gets past: `git diff HEAD`, `git diff --quiet`, ….
const GIT_DIFF = /['"`]diff['"`]|git\s+diff/

let failed = false
for (const task of tasks) {
  const work = mkdtempSync(join(tmpdir(), `ctxjev-task-${task}-`))
  const repo = join(work, 'repo')
  const pristine = join(work, 'pristine')
  const { format = 1 } = JSON.parse(readFileSync(join(root, task, 'task.json'), 'utf8'))
  let setupError = ''
  try {
    setUp(task, repo)
    setUp(task, pristine)
  } catch (err) {
    const lines = String(err.stderr ?? err.message).split('\n')
    setupError = lines.find((l) => /^Error\b/.test(l.trim()))?.trim() ?? lines.filter(Boolean).pop()
  }
  if (setupError) {
    failed = true
    console.log(`FAIL ${task.padEnd(20)} setup: ${setupError}`)
    rmSync(work, { recursive: true, force: true })
    continue
  }
  cpSync(join(root, task, 'hidden'), join(repo, 'test-hidden'), { recursive: true })
  const env = { CTXJEV_PRISTINE_REPO: pristine }

  const templateTests = passes(repo, ['test/*.test.js'])
  const hiddenBefore = passes(repo, ['test-hidden/*.test.js'], env)
  cpSync(join(root, task, 'solution'), repo, { recursive: true })
  const hiddenAfter = passes(repo, ['test-hidden/*.test.js'], env)
  const templateAfter = passes(repo, ['test/*.test.js'])
  // Code only: a comment explaining why the check isn't git diff mentions git diff.
  const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const hiddenFiles = readdirSync(join(root, task, 'hidden')).map((f) => withoutComments(readFileSync(join(root, task, 'hidden', f), 'utf8')))
  const noGitDiff = format < 2 || !hiddenFiles.some((text) => GIT_DIFF.test(text))

  const ok = templateTests && !hiddenBefore && hiddenAfter && templateAfter && noGitDiff
  failed ||= !ok
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${task.padEnd(20)} template tests: ${templateTests}, hidden before fix: ${hiddenBefore}, hidden after fix: ${hiddenAfter}, template after fix: ${templateAfter}` +
      (format >= 2 ? `, format 2: history replayed with real diffs, no git-diff check: ${noGitDiff}` : ''),
  )
  rmSync(work, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
