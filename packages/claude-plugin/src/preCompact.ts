#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseClaudeCodeTranscript, resolveClaudeCodeGoal, type Entry } from 'ctxjev-core'
import { writeLastRun, type LastRun } from './lastRun.js'
import { clearPreservedContext, writePreservedContext } from './preserve.js'
import { removeLegacyState } from './stateDir.js'
import { readStdin } from './readStdin.js'
import { preserveLimitFromEnv, selectPreserved, type Scorer, type SelectedEntry } from './select.js'

type PreCompactInput = { cwd?: string; transcript_path?: string; session_id?: string }

// Compaction waits on this hook, and hooks/hooks.json gives it 15s. A Jev request normally takes
// well under a second; past this, scoring falls back to offline instead of holding the user up.
const DEFAULT_JEV_TIMEOUT_MS = 8_000

/**
 * Runs just before Claude Code compacts the conversation. Scores the transcript (with Jev, or
 * offline if it isn't available) and caches the highest-relevance entries for
 * sessionStartCompact.ts to re-inject once compaction finishes.
 *
 * This can only ever exit 0 (a hook error must never block the user's actual compaction) — every
 * outcome, including a failure, is recorded in the session's `last-run.json` (see stateDir.ts)
 * instead of surfaced mid-compaction.
 */
async function main() {
  const input: PreCompactInput = JSON.parse(await readStdin())
  const { cwd, transcript_path: transcriptPath, session_id: sessionId } = input
  if (!cwd) return

  // A stale snapshot from an earlier compaction must never survive any of the early returns below.
  await clearPreservedContext(cwd, sessionId)
  await removeLegacyState(cwd).catch(() => {})

  let result: Omit<LastRun, 'at' | 'sessionId'>
  try {
    result = await run(cwd, sessionId, transcriptPath)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('ctxjev preCompact:', reason)
    result = { outcome: 'error', reason }
  }
  await writeLastRun(cwd, { at: new Date().toISOString(), sessionId, ...result })
}

async function run(cwd: string, sessionId: string | undefined, transcriptPath: string | undefined): Promise<Omit<LastRun, 'at' | 'sessionId'>> {
  if (!transcriptPath) return { outcome: 'skipped', reason: 'Claude Code did not provide a transcript_path' }

  const jsonl = await readFile(transcriptPath, 'utf8')
  const entries = parseClaudeCodeTranscript(jsonl)
  if (entries.length === 0) return { outcome: 'skipped', reason: 'nothing in the transcript since the last compaction' }

  const resolved = resolveClaudeCodeGoal(jsonl, entries)
  if (!resolved) return { outcome: 'skipped', reason: 'no goal set for this session and no chat message to infer one from' }

  const limit = preserveLimitFromEnv(process.env.CTXJEV_PRESERVE_LIMIT)
  const { selected, scorer, note } = await scoreForPreservation(entries, resolved.goal, limit)
  const info = { goal: resolved.goal, goalSource: resolved.source, entriesScored: entries.length, scorer, note }
  if (selected.length === 0) return { outcome: 'skipped', reason: 'nothing scored relevant enough to preserve', ...info }

  await writePreservedContext(cwd, sessionId, { goal: resolved.goal, scoredAt: new Date().toISOString(), scorer, entries: selected })
  return { outcome: 'preserved', preserved: selected.length, ...info }
}

// Without Jev (no key, a failed request, or no answer in time), the offline heuristic still beats preserving nothing.
async function scoreForPreservation(entries: Entry[], goal: string, limit: number): Promise<{ selected: SelectedEntry[]; scorer: Scorer; note?: string }> {
  const offline = async (note: string) => ({ selected: await selectPreserved(entries, goal, limit, 'local'), scorer: 'local' as const, note })

  if (!process.env.TYPESAFE_API_KEY) {
    return offline('TYPESAFE_API_KEY is not set in the environment Claude Code runs in — scored offline by keyword overlap instead')
  }

  const timeoutMs = jevTimeoutFromEnv(process.env.CTXJEV_JEV_TIMEOUT_MS)
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from Jev within ${timeoutMs / 1000}s`)), timeoutMs)
  })
  try {
    return { selected: await Promise.race([selectPreserved(entries, goal, limit, 'jev'), deadline]), scorer: 'jev' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('ctxjev preCompact: falling back to offline scoring:', reason)
    return offline(`Jev request failed (${reason}) — scored offline by keyword overlap instead`)
  } finally {
    clearTimeout(timer)
  }
}

// Only ever shortens the deadline (tests use it); it can't be raised past what hooks.json allows.
function jevTimeoutFromEnv(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 && n <= DEFAULT_JEV_TIMEOUT_MS ? n : DEFAULT_JEV_TIMEOUT_MS
}

main()
  .catch((err: unknown) => {
    console.error('ctxjev preCompact:', err instanceof Error ? err.message : String(err))
  })
  // A timed-out Jev request's socket would otherwise keep the process alive until Claude Code kills it.
  .finally(() => process.exit(0))
