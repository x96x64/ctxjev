import type { Entry } from 'ctxjev-core'

export type TranscriptFile = {
  /** Optional — omit to require --goal on the command line instead. */
  goal?: string
  entries: Entry[]
}

export function parseTranscript(raw: string): TranscriptFile {
  const parsed: unknown = JSON.parse(raw)

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
