#!/usr/bin/env node
import { readPreservedContext } from './preserve.js'
import { readStdin } from './readStdin.js'

type SessionStartInput = { cwd?: string }

/**
 * Runs right after Claude Code finishes compacting (SessionStart, matcher "compact"). Reads
 * whatever preCompact.ts cached and prints a digest to stdout — Claude Code adds this text to
 * context as a system reminder, the documented way to recover state a summarization pass might
 * otherwise have smoothed over.
 */
async function main() {
  const input: SessionStartInput = JSON.parse(await readStdin())
  if (!input.cwd) return

  const preserved = await readPreservedContext(input.cwd)
  if (!preserved || preserved.entries.length === 0) return

  const lines = [
    `ctxjev preserved context through compaction (goal: ${preserved.goal}):`,
    ...preserved.entries.map((e) => `- [score ${e.combinedScore.toFixed(2)}] ${e.content}`),
  ]
  console.log(lines.join('\n'))
}

main().catch((err: unknown) => {
  console.error('ctxjev sessionStartCompact:', err instanceof Error ? err.message : String(err))
})
