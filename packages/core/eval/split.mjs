// Which eval material may inform design. Tasks and the sessions recorded on them are `dev` (used to
// design and tune, so their numbers are optimistic) or `holdout` (untouched until the comparison
// in PREREGISTRATION.md has run). A task.json without `split` is dev; so is every hand-written session.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const tasksDir = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/eval-tasks')
export const SPLITS = ['dev', 'holdout', 'all']

export function parseSplit(value) {
  if (!SPLITS.includes(value)) throw new Error(`--split must be one of ${SPLITS.join(', ')}, got ${value}`)
  return value
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

export const inSplit = (split, wanted) => wanted === 'all' || split === wanted
