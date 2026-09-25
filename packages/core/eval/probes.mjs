// Rules for the probes (facts a task needs later, asked as questions) that a task's format adds.
// Format 2 (new tasks, Round 2 on): a Japanese task's probes are written in Japanese, questions and
// facts both. Two of Round 1's Japanese holdout sessions had English probes while the dev ones were
// Japanese, so the answering and judging models worked in a different language per split.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tasksDir } from './split.mjs'

const JAPANESE = /[\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}]/u

/** What's wrong with `probes` for `taskSpec` (its task.json), empty when nothing is. */
export function probeLanguageProblems(taskSpec, probes) {
  if ((taskSpec.format ?? 1) < 2 || taskSpec.language !== 'ja') return []
  return probes.flatMap((probe, i) =>
    ['question', 'fact']
      .filter((field) => !JAPANESE.test(probe[field] ?? ''))
      .map((field) => `probe ${i + 1} ("${String(probe.fact ?? '').slice(0, 40)}"): its ${field} isn't in Japanese, and this is a Japanese format-2 task`),
  )
}

/** task.json for a recorded session's task, or undefined for a hand-written session. */
export function taskSpecFor(session, dir = process.env.CTXJEV_TASKS_DIR ?? tasksDir) {
  if (!session.task) return undefined
  const path = join(dir, session.task, 'task.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
}
