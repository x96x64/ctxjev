#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseClaudeCodeTranscript, transcriptStartTime } from 'ctxjev-core'
import { resolveGoal } from './goal.js'
import { writeLastRun, type LastRun } from './lastRun.js'
import { clearPreservedContext, writePreservedContext } from './preserve.js'
import { readStdin } from './readStdin.js'
import { preserveLimitFromEnv, selectPreserved } from './select.js'

type PreCompactInput = { cwd?: string; transcript_path?: string }

/**
 * Runs just before Claude Code compacts the conversation. Scores the transcript with Jev and
 * caches the highest-relevance entries to `.ctxjev/preserved-context.json`, for
 * sessionStartCompact.ts to re-inject as a reminder once compaction finishes.
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
  if (!process.env.TYPESAFE_API_KEY) {
    return { outcome: 'skipped', reason: 'TYPESAFE_API_KEY is not set in the environment Claude Code runs in' }
  }
  if (!transcriptPath) return { outcome: 'skipped', reason: 'Claude Code did not provide a transcript_path' }

  const jsonl = await readFile(transcriptPath, 'utf8')
  const entries = parseClaudeCodeTranscript(jsonl)
  if (entries.length === 0) return { outcome: 'skipped', reason: 'nothing in the transcript since the last compaction' }

  const resolved = await resolveGoal(cwd, entries, transcriptStartTime(jsonl))
  if (!resolved) return { outcome: 'skipped', reason: 'no goal set for this session and no chat message to infer one from' }

  const goalInfo = { goal: resolved.goal, goalSource: resolved.source, ignoredStaleGoal: resolved.ignoredStaleGoal }
  const selected = await selectPreserved(entries, resolved.goal, preserveLimitFromEnv(process.env.CTXJEV_PRESERVE_LIMIT))
  if (selected.length === 0) return { outcome: 'skipped', reason: 'nothing besides the goal itself to preserve', entriesScored: entries.length, ...goalInfo }

  await writePreservedContext(cwd, { goal: resolved.goal, scoredAt: new Date().toISOString(), entries: selected })
  return { outcome: 'preserved', entriesScored: entries.length, preserved: selected.length, ...goalInfo }
}

main().catch((err: unknown) => {
  console.error('ctxjev preCompact:', err instanceof Error ? err.message : String(err))
})
