import { estimateTokens, inferGoalFromEntries, messagesToEntries, parseClaudeCodeTranscript, resolveClaudeCodeGoal, type AnthropicMessage, type Entry, type EntryRole } from 'ctxjev-core'

const VALID_ROLES: EntryRole[] = ['user', 'assistant', 'tool']

export type TranscriptFile =
  | { format: 'ctxjev'; goal?: string; entries: Entry[] }
  | { format: 'claude-code'; goal?: string; entries: Entry[] }
  /** `wrapped`: the file was `{ goal?, messages }` rather than a bare array, so output keeps that shape. */
  | { format: 'anthropic-messages'; goal?: string; entries: Entry[]; messages: AnthropicMessage[]; wrapped: boolean }

/**
 * Accepts three formats, auto-detected: ctxjev's own `{ goal?, entries }` (see
 * examples/sample-transcripts), an Anthropic Messages conversation (a `messages` array, bare or as
 * `{ goal?, messages }`), or a real Claude Code session transcript (`.jsonl`, one record per line).
 * The first two parse as one JSON value; a `.jsonl` file doesn't (one value per line), so a
 * `JSON.parse` failure is what triggers the Claude Code path, with no flag or file extension needed.
 */
export function parseTranscript(raw: string): TranscriptFile {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    // Not a single JSON document at all — most likely a Claude Code .jsonl transcript instead.
    return parseClaudeCode(raw)
  }

  // A one-line .jsonl is also a valid single JSON document; its shape still gives it away.
  if (looksLikeClaudeCodeRecord(parsedJson)) return parseClaudeCode(raw)

  if (Array.isArray(parsedJson)) return parseAnthropicMessages(parsedJson, undefined, false)
  if (typeof parsedJson === 'object' && parsedJson !== null && 'messages' in parsedJson) {
    const { messages, goal } = parsedJson as { messages: unknown; goal?: unknown }
    return parseAnthropicMessages(messages, goal, true)
  }
  return parseCtxjevFormat(parsedJson)
}

function parseClaudeCode(raw: string): TranscriptFile {
  const entries = parseClaudeCodeTranscript(raw, { countTokens: estimateTokens })
  if (entries.length === 0) {
    throw new Error(
      'could not parse this file as a ctxjev transcript (an "entries" array), an Anthropic Messages conversation (a "messages" array), or a Claude Code session .jsonl',
    )
  }
  return { format: 'claude-code', goal: resolveClaudeCodeGoal(raw, entries)?.goal, entries }
}

function looksLikeClaudeCodeRecord(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
  const record = parsed as Record<string, unknown>
  return typeof record.type === 'string' && ('uuid' in record || 'sessionId' in record || 'message' in record) && !('entries' in record) && !('messages' in record)
}

function parseAnthropicMessages(messages: unknown, goal: unknown, wrapped: boolean): TranscriptFile {
  if (!Array.isArray(messages)) throw new Error('"messages" must be an array')
  if (goal !== undefined && typeof goal !== 'string') throw new Error('"goal" must be a string when present')
  messages.forEach((message, index) => {
    const { role, content } = (message ?? {}) as Record<string, unknown>
    if (role !== 'user' && role !== 'assistant') throw new Error(`messages[${index}].role must be "user" or "assistant"`)
    if (typeof content !== 'string' && !Array.isArray(content)) throw new Error(`messages[${index}].content must be a string or an array of blocks`)
  })
  const typed = messages as AnthropicMessage[]
  const entries = messagesToEntries(typed)
  return { format: 'anthropic-messages', goal: goal ?? inferGoalFromEntries(entries), entries, messages: typed, wrapped }
}

function parseCtxjevFormat(parsed: unknown): TranscriptFile {
  if (typeof parsed !== 'object' || parsed === null || !('entries' in parsed)) {
    throw new Error('transcript file must be a JSON object with an "entries" array, or an Anthropic Messages "messages" array — see examples/sample-transcripts')
  }

  const { entries, goal } = parsed as { entries: unknown; goal?: unknown }

  if (!Array.isArray(entries)) {
    throw new Error('"entries" must be an array')
  }

  if (goal !== undefined && typeof goal !== 'string') {
    throw new Error('"goal" must be a string when present')
  }

  entries.forEach((entry, index) => validateEntry(entry, index))

  return { format: 'ctxjev', goal, entries: entries as Entry[] }
}

/** A malformed entry (a bad timestamp, especially) doesn't fail loudly — it poisons every other
 * entry's recency-relative score to NaN, which then silently reads as "keep everything". Reject
 * it here instead, at the one place ctxjev's own transcript format is actually parsed. */
function validateEntry(entry: unknown, index: number): void {
  const where = `entries[${index}]`
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`${where} must be an object`)
  }

  const { id, role, toolName, content, timestamp } = entry as Record<string, unknown>

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`${where}.id must be a non-empty string`)
  }
  if (typeof role !== 'string' || !VALID_ROLES.includes(role as EntryRole)) {
    throw new Error(`${where}.role must be one of ${VALID_ROLES.join(', ')}`)
  }
  if (toolName !== undefined && typeof toolName !== 'string') {
    throw new Error(`${where}.toolName must be a string when present`)
  }
  if (typeof content !== 'string') {
    throw new Error(`${where}.content must be a string`)
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new Error(`${where}.timestamp must be a finite number`)
  }
}
