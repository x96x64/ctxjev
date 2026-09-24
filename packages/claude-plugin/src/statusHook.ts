#!/usr/bin/env node
import { readStdin } from './readStdin.js'
import { statusReport } from './status.js'

type UserPromptSubmitInput = { prompt?: string; cwd?: string; session_id?: string; transcript_path?: string }

// Only the bare command: `/ctxjev:status` and nothing after it.
const STATUS_COMMAND = /^\/ctxjev:status\s*$/

/**
 * UserPromptSubmit: answers `/ctxjev:status` without a model turn, by blocking the prompt with the
 * report as the reason. As a skill it took a model turn, and in manual tests Claude Haiku used that
 * turn to start editing and committing code after a compaction; with a neutral message in the same
 * place it did nothing. Any other prompt passes through untouched, and so does this one if anything
 * goes wrong, in which case the skill still answers it.
 */
async function main() {
  const input: UserPromptSubmitInput = JSON.parse(await readStdin())
  if (typeof input.prompt !== 'string' || !STATUS_COMMAND.test(input.prompt.trim())) return
  const report = await statusReport(input.cwd ?? process.cwd(), input.session_id, input.transcript_path)
  console.log(JSON.stringify({ decision: 'block', reason: report }))
}

main().catch(() => {
  // Never get in the way of the user's prompt.
})
