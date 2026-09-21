import { inferGoalFromEntries, parseClaudeCodeTranscript, type Entry } from 'ctxjev-core'

export type TranscriptFile = {
  /** Optional — omit to require --goal on the command line instead. */
  goal?: string
  entries: Entry[]
}

/**
 * Accepts two formats, auto-detected: ctxjev's own `{ goal?, entries }` (a single JSON document
 * — see examples/sample-transcripts) or a real Claude Code session transcript (`.jsonl`, one
 * record per line, from `transcript_path` or `~/.claude/projects/*​/*.jsonl`). ctxjev's own format
 * parses as one JSON value across the whole file; a `.jsonl` file does not (multiple top-level
 * values, one per line), so a `JSON.parse` failure is what triggers the Claude Code path rather
 * than needing a file extension or an explicit flag.
 */
export function parseTranscript(raw: string): TranscriptFile {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    // Not a single JSON document at all — most likely a Claude Code .jsonl transcript instead.
    // A genuinely malformed ctxjev-format file (valid JSON, wrong shape) never reaches this
    // branch; parseCtxjevFormat below throws its own specific error for that case.
    const entries = parseClaudeCodeTranscript(raw)
    if (entries.length === 0) {
      throw new Error(
        'could not parse this file as either a ctxjev transcript (a single JSON document with an "entries" array) or a Claude Code session .jsonl',
      )
    }
    return { goal: inferGoalFromEntries(entries), entries }
  }

  return parseCtxjevFormat(parsedJson)
}

function parseCtxjevFormat(parsed: unknown): TranscriptFile {
  if (typeof parsed !== 'object' || parsed === null || !('entries' in parsed)) {
    throw new Error('transcript file must be a JSON object with an "entries" array — see examples/sample-transcripts')
  }

  const { entries, goal } = parsed as { entries: unknown; goal?: unknown }

  if (!Array.isArray(entries)) {
    throw new Error('"entries" must be an array')
  }

  if (goal !== undefined && typeof goal !== 'string') {
    throw new Error('"goal" must be a string when present')
  }

  return { goal, entries: entries as Entry[] }
}
