// Which eval material may inform design. Tasks and the sessions recorded on them are `dev` (used to
// design and tune, so their numbers are optimistic), `holdout` (Round 1's comparison in
// PREREGISTRATION.md; now seen, so it confirms nothing new), or `holdout2` (Round 2's, untouched
// until its preregistered run). A task.json without `split` is dev; so is every hand-written session.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const tasksDir = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/eval-tasks')
// holdout2: Round 2's preregistered set. `all` means dev and holdout only: holdout2 is read by name,
// and only once its labels are committed (see parseSplit).
export const SPLITS = ['dev', 'holdout', 'holdout2', 'all']
const sessionsDir = join(tasksDir, '../eval-sessions')

export function parseSplit(value) {
  if (!SPLITS.includes(value)) throw new Error(`--split must be one of ${SPLITS.join(', ')}, got ${value}`)
  if (value === 'holdout2') requireCommittedLabels()
  return value
}

/**
 * Round 2's plan: no scorer runs on a holdout2 session before its labels are committed. Every
 * holdout2 session file must be in git with no uncommitted change, or nothing reads the split.
 */
function requireCommittedLabels() {
  const files = existsSync(sessionsDir) ? readdirSync(sessionsDir).filter((f) => sessionSplit(f) === 'holdout2').map((f) => join(sessionsDir, f)) : []
  const problems = []
  for (const file of files) {
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', file], { cwd: sessionsDir }).status === 0
    const clean = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', file], { cwd: sessionsDir }).status === 0
    if (!tracked || !clean) problems.push(file)
  }
  if (problems.length > 0) throw new Error(`holdout2 labels aren't committed, so no scorer may read them yet:\n  ${problems.join('\n  ')}`)
}

export function taskSplit(task) {
  const path = join(tasksDir, task, 'task.json')
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')).split ?? 'dev') : 'dev'
}

/** A session file's split: its task's, for `recorded-<task>.json`; dev otherwise. */
export function sessionSplit(fileName) {
  const task = /^recorded-(.+)\.json$/.exec(fileName)?.[1]
  return task ? taskSplit(task) : 'dev'
}

export const inSplit = (split, wanted) => (wanted === 'all' ? split === 'dev' || split === 'holdout' : split === wanted)
