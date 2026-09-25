#!/usr/bin/env node
/**
 * Checks the Round 2 task format without any model call, on the fixture task in
 * eval/fixtures/tasks/format2-demo (a small Japanese task written to exercise the format; it's in
 * no split and no eval reads it). CI runs it.
 *
 * - setup.mjs gives every history commit after the first a real change, the same commits every
 *   time, ending exactly at template/, and refuses a format-2 commit without a diff;
 * - a hidden test's "must not change" check compares with the pristine copy the harness provides,
 *   so a change the agent committed still fails it (a `git diff HEAD` check passes it);
 * - a Japanese format-2 task's probes must be in Japanese;
 * - verify.mjs accepts the fixture.
 *
 *   node eval/harness-selftest.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeLanguageProblems } from './probes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures/tasks')
const setupScript = join(here, '../../../examples/eval-tasks/setup.mjs')
const TASK = 'format2-demo'
const results = []
const check = (label, ok, detail = '') => results.push({ label, ok, detail })

const work = mkdtempSync(join(tmpdir(), 'ctxjev-harness-selftest-'))
const setUp = (dest, tasksDir = fixtures) => spawnSync('node', [setupScript, TASK, dest], { encoding: 'utf8', env: { ...process.env, CTXJEV_TASKS_DIR: tasksDir } })
const git = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

try {
  // 1. Real history, deterministic, ending at template/.
  const a = join(work, 'a')
  const b = join(work, 'b')
  check('setup.mjs replays the format-2 history', setUp(a).status === 0 && setUp(b).status === 0)
  const commits = git(a, ['log', '--reverse', '--format=%H']).split('\n')
  const spec = JSON.parse(readFileSync(join(fixtures, TASK, 'task.json'), 'utf8'))
  check('one commit per history entry', commits.length === spec.history.length, `${commits.length} commits`)
  const changed = commits.slice(1).map((c) => git(a, ['show', '--format=', '--name-only', c]))
  check('every commit after the first changes files', changed.every((files) => files.length > 0), changed.join(' | '))
  check("the commit the probes would name holds the change it's named for", git(a, ['show', commits[1], '--', 'src/cart.js']).includes('+  if (cart.items.length > maxItems)'))
  check('the same commits every time', git(b, ['log', '--format=%H']) === git(a, ['log', '--format=%H']))

  // 2. A format-2 commit without a diff is refused.
  const broken = join(work, 'broken-tasks')
  cpSync(fixtures, broken, { recursive: true })
  const brokenSpec = JSON.parse(readFileSync(join(broken, TASK, 'task.json'), 'utf8'))
  delete brokenSpec.history[1].diff
  writeFileSync(join(broken, TASK, 'task.json'), JSON.stringify(brokenSpec))
  const refused = setUp(join(work, 'c'), broken)
  check('a format-2 commit without a diff is refused', refused.status !== 0 && refused.stderr.includes('has no diff'))

  // 3. "Must not change", against the pristine copy: an agent that edits the protected file and
  // commits the edit still fails, where a `git diff HEAD` check would pass it.
  const repo = join(work, 'agent')
  const pristine = join(work, 'pristine')
  setUp(repo)
  setUp(pristine)
  cpSync(join(fixtures, TASK, 'solution'), repo, { recursive: true })
  cpSync(join(fixtures, TASK, 'hidden'), join(repo, 'test-hidden'), { recursive: true })
  const hidden = () => spawnSync('node', ['--test', 'test-hidden/*.test.js'], { cwd: repo, encoding: 'utf8', env: { PATH: process.env.PATH, CTXJEV_PRISTINE_REPO: pristine } })
  check('the solution passes the hidden tests', hidden().status === 0)
  writeFileSync(join(repo, 'config/limits.json'), '{ "maxItems": 21 }\n')
  execFileSync('git', ['-c', 'user.name=agent', '-c', 'user.email=a@b', 'commit', '-qam', 'bump the limit'], { cwd: repo })
  const gitDiffCheck = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'config/limits.json'], { cwd: repo })
  check('(a git diff HEAD check is fooled by the commit)', gitDiffCheck.status === 0)
  check('the pristine-copy check is not: a committed change to a protected file fails', hidden().status !== 0)

  // 4. Japanese probes for a Japanese format-2 task.
  const ja = { format: 2, language: 'ja' }
  check('an English probe on a Japanese format-2 task is refused', probeLanguageProblems(ja, [{ question: 'What is the limit?', fact: 'maxItems is 20' }]).length === 2)
  check('a Japanese probe is accepted', probeLanguageProblems(ja, [{ question: 'カートの上限はいくつ？', fact: 'config/limits.json の maxItems は 20' }]).length === 0)
  check('format-1 tasks keep the probes they have', probeLanguageProblems({ language: 'ja' }, [{ question: 'What is the limit?', fact: 'x' }]).length === 0)

  // 5. verify.mjs on the fixture.
  const verify = spawnSync('node', [join(here, '../../../examples/eval-tasks/verify.mjs')], { encoding: 'utf8', env: { ...process.env, CTXJEV_TASKS_DIR: fixtures } })
  check('verify.mjs accepts the fixture', verify.status === 0, verify.stdout.trim())
} finally {
  rmSync(work, { recursive: true, force: true })
}

for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${r.ok || !r.detail ? '' : `: ${r.detail}`}`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
