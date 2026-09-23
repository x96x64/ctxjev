#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseClaudeCodeTranscript, transcriptStartTime, type Entry } from 'ctxjev-core'
import { resolveGoal } from './goal.js'
import { writeLastRun, type LastRun } from './lastRun.js'
import { clearPreservedContext, writePreservedContext } from './preserve.js'
import { readStdin } from './readStdin.js'
import { preserveLimitFromEnv, selectPreserved, type Scorer, type SelectedEntry } from './select.js'

type PreCompactInput = { cwd?: string; transcript_path?: string }

/**
 * Runs just before Claude Code compacts the conversation. Scores the transcript (with Jev, or
 * offline if it isn't available) and caches the highest-relevance entries to
 * `.ctxjev/preserved-context.json`, for sessionStartCompact.ts to re-inject once compaction finishes.
 *
 * This can only ever exit 0 (a hook error must never block the user's actual compaction) — every
 * outcome, including a failure, is recorded in `.ctxjev/last-run.json` instead of surfaced
 * mid-compaction.
 */
async function main() {
  const input: PreCompactInput = JSON.parse(await readStdin())
  const { cwd, transcript_path: transcriptPath } = input
  if (!cwd) return

  // A stale snapshot from an earlier compaction must never survive any of the early returns below.
  await clearPreservedContext(cwd)

  let result: Omit<LastRun, 'at'>
  try {
    result = await run(cwd, transcriptPath)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('ctxjev preCompact:', reason)
    result = { outcome: 'error', reason }
  }
  await writeLastRun(cwd, { at: new Date().toISOString(), ...result })
}

async function run(cwd: string, transcriptPath: string | undefined): Promise<Omit<LastRun, 'at'>> {
  if (!transcriptPath) return { outcome: 'skipped', reason: 'Claude Code did not provide a transcript_path' }

  const jsonl = await readFile(transcriptPath, 'utf8')
  const entries = parseClaudeCodeTranscript(jsonl)
  if (entries.length === 0) return { outcome: 'skipped', reason: 'nothing in the transcript since the last compaction' }

  const resolved = await resolveGoal(cwd, entries, transcriptStartTime(jsonl))
  if (!resolved) return { outcome: 'skipped', reason: 'no goal set for this session and no chat message to infer one from' }

  const limit = preserveLimitFromEnv(process.env.CTXJEV_PRESERVE_LIMIT)
  const { selected, scorer, note } = await scoreForPreservation(entries, resolved.goal, limit)
  const info = { goal: resolved.goal, goalSource: resolved.source, ignoredStaleGoal: resolved.ignoredStaleGoal, entriesScored: entries.length, scorer, note }
  if (selected.length === 0) return { outcome: 'skipped', reason: 'nothing besides the goal itself to preserve', ...info }

  await writePreservedContext(cwd, { goal: resolved.goal, scoredAt: new Date().toISOString(), scorer, entries: selected })
  return { outcome: 'preserved', preserved: selected.length, ...info }
}

// Without Jev (no key, or the request failed), the offline heuristic still beats preserving nothing.
async function scoreForPreservation(entries: Entry[], goal: string, limit: number): Promise<{ selected: SelectedEntry[]; scorer: Scorer; note?: string }> {
  const offline = async (note: string) => ({ selected: await selectPreserved(entries, goal, limit, 'local'), scorer: 'local' as const, note })

  if (!process.env.TYPESAFE_API_KEY) {
    return offline('TYPESAFE_API_KEY is not set in the environment Claude Code runs in — scored offline by keyword overlap instead')
  }
  try {
    return { selected: await selectPreserved(entries, goal, limit, 'jev'), scorer: 'jev' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('ctxjev preCompact: Jev request failed, falling back to offline scoring:', reason)
    return offline(`Jev request failed (${reason}) — scored offline by keyword overlap instead`)
  }
}

main().catch((err: unknown) => {
  console.error('ctxjev preCompact:', err instanceof Error ? err.message : String(err))
})
