#!/usr/bin/env node
// Checks every task without calling any model: the template's own tests pass, the hidden
// acceptance tests fail on the untouched template, and pass once solution/ is applied.
// Usage: node examples/eval-tasks/verify.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// `node --test <glob>` expands the glob itself only from Node 21 on; see .nvmrc.
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`verify.mjs needs Node 22 or later (see .nvmrc); this is Node ${process.versions.node}.`)
  process.exit(1)
}

const root = dirname(fileURLToPath(import.meta.url))
const tasks = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory())

function passes(cwd, args) {
  try {
    execFileSync('node', ['--test', ...args], { cwd, stdio: 'pipe', env: { PATH: process.env.PATH }, timeout: 60_000 })
    return true
  } catch {
    return false
  }
}

let failed = false
for (const task of tasks) {
  const work = mkdtempSync(join(tmpdir(), `ctxjev-task-${task}-`))
  const repo = join(work, 'repo')
  execFileSync('node', [join(root, 'setup.mjs'), task, repo], { stdio: 'pipe' })
  cpSync(join(root, task, 'hidden'), join(repo, 'test-hidden'), { recursive: true })

  const templateTests = passes(repo, ['test/*.test.js'])
  const hiddenBefore = passes(repo, ['test-hidden/*.test.js'])
  cpSync(join(root, task, 'solution'), repo, { recursive: true })
  const hiddenAfter = passes(repo, ['test-hidden/*.test.js'])
  const templateAfter = passes(repo, ['test/*.test.js'])

  const ok = templateTests && !hiddenBefore && hiddenAfter && templateAfter
  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${task.padEnd(20)} template tests: ${templateTests}, hidden before fix: ${hiddenBefore}, hidden after fix: ${hiddenAfter}, template after fix: ${templateAfter}`)
  rmSync(work, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
