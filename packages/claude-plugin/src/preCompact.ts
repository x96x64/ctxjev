#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseClaudeCodeTranscript } from 'ctxjev-core'
import { resolveGoal } from './goal.js'
import { writePreservedContext } from './preserve.js'
import { readStdin } from './readStdin.js'
import { selectPreserved } from './select.js'

type PreCompactInput = { cwd?: string; transcript_path?: string }

/**
 * Runs just before Claude Code compacts the conversation. Scores the transcript with Jev and
 * caches the highest-relevance entries to `.ctxjev/preserved-context.json`, for
 * sessionStartCompact.ts to re-inject as a reminder once compaction finishes.
 *
 * This can only ever exit 0 (a hook error must never block the user's actual compaction) — any
 * failure, including a missing API key, is a silent no-op rather than an error surfaced to the
 * user mid-compaction.
 */
async function main() {
  const input: PreCompactInput = JSON.parse(await readStdin())
  const { cwd, transcript_path: transcriptPath } = input

  if (!process.env.TYPESAFE_API_KEY || !cwd || !transcriptPath) return

  const jsonl = await readFile(transcriptPath, 'utf8')
  const entries = parseClaudeCodeTranscript(jsonl)
  if (entries.length === 0) return

  const goal = await resolveGoal(cwd, entries)
  if (!goal) return

  const selected = await selectPreserved(entries, goal)
  if (selected.length === 0) return

  await writePreservedContext(cwd, { goal, scoredAt: new Date().toISOString(), entries: selected })
}

main().catch((err: unknown) => {
  console.error('ctxjev preCompact:', err instanceof Error ? err.message : String(err))
})
