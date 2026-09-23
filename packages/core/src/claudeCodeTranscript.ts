import { redactSecrets } from './redact.js'
import type { Entry } from './types.js'

/**
 * Parses Claude Code's own session transcript format (one JSON record per line, at
 * `transcript_path`, or any `.jsonl` session log under `~/.claude/projects`) into ctxjev's plain
 * `Entry[]`. This format is Claude Code's internal representation, not a documented public API
 * — it may change between versions. Keeping the parsing isolated to this one module means a
 * schema change is a one-file fix. Shared by `ctxjev-claude` (scoring the live transcript at
 * `PreCompact`) and `ctxjev-cli` (analyzing a saved transcript file directly).
 *
 * Only three things become entries: a plain user chat message, an assistant text reply, and a
 * tool call — combining its `tool_use` (name + input) with the matching `tool_result` (output)
 * into one entry, the same shape `examples/sample-transcripts` uses. Everything else in the
 * transcript (thinking blocks, environment attachments, file-history snapshots, Claude Code's own
 * bookkeeping records) is Claude Code's internal state, not agent "history" in the sense ctxjev
 * scores — it's intentionally skipped.
 *
 * Sidechain records (`isSidechain: true` — a subagent's own private conversation, spawned via the
 * Agent tool) are skipped entirely, not merged into the main thread. A subagent's work already
 * shows up in the main thread as an ordinary tool_use/tool_result pair (the call and its result);
 * its internal back-and-forth getting there was never part of what Claude Code would compact for
 * the *parent* session in the first place, so scoring it here would be scoring content that isn't
 * actually part of the context this plugin is trying to protect.
 */

type KnownContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | Array<{ type: string; text?: string }>; is_error?: boolean }

type TranscriptRecord = {
  type: string
  subtype?: string
  uuid?: string
  timestamp?: string
  isSidechain?: boolean
  isCompactSummary?: boolean
  message?: { role: string; content: string | unknown[] }
}

function asKnownBlock(raw: unknown): KnownContentBlock | undefined {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) return undefined
  return raw as KnownContentBlock
}

const MAX_CONTENT_LENGTH = 600

/** Collapses whitespace and clips to `max` chars with an ellipsis — shared with `ctxjev-cli`'s
 * report formatting so the same normalize-and-truncate behavior isn't reimplemented twice. */
export function truncate(text: string, max: number = MAX_CONTENT_LENGTH): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

// Masked here too (not only in jevClient) because parsed entries are also written to disk by ctxjev-claude.
function excerpt(text: string): string {
  return truncate(redactSecrets(text))
}

// Tool output keeps its head *and* tail: a test run's summary line or an error's final message is
// usually at the end, exactly what a head-only cut throws away.
function toolExcerpt(text: string, max: number = MAX_CONTENT_LENGTH): string {
  const oneLine = redactSecrets(text).replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  const headLength = Math.ceil(max * 0.6)
  const tailLength = max - headLength - 3
  return `${oneLine.slice(0, headLength)} … ${oneLine.slice(-tailLength)}`
}

function toolResultText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content
  return content
    .map((block) => (block.type === 'text' ? block.text ?? '' : `[${block.type}]`))
    .filter(Boolean)
    .join(' ')
}

// Which input field identifies a call for the common tools — "Bash: 12 passed" alone doesn't say what ran.
const TOOL_INPUT_KEYS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']

function toolInputSummary(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const record = input as Record<string, unknown>
  for (const key of TOOL_INPUT_KEYS) {
    if (typeof record[key] === 'string' && record[key]) return truncate(record[key] as string, 160)
  }
  return Object.keys(record).length > 0 ? truncate(JSON.stringify(record), 160) : ''
}

function toolLabel(name: string, input: unknown): string {
  const summary = toolInputSummary(input)
  return summary ? `${name}(${summary})` : name
}

const COMPACT_SUMMARY_PREFIX = 'This session is being continued from a previous conversation'

// Everything before the most recent compaction is already out of context — only what follows it is.
function isCompactionBoundary(record: TranscriptRecord): boolean {
  if (record.type === 'system' && record.subtype === 'compact_boundary') return true
  if (record.type !== 'user') return false
  if (record.isCompactSummary) return true
  return firstText(record.message?.content)?.trimStart().startsWith(COMPACT_SUMMARY_PREFIX) ?? false
}

function firstText(content: string | unknown[] | undefined): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  for (const raw of content) {
    const block = asKnownBlock(raw)
    if (block?.type === 'text') return block.text
  }
  return undefined
}

function toTimestampMs(timestamp: string | undefined): number {
  if (!timestamp) return 0
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function parseClaudeCodeTranscript(jsonl: string): Entry[] {
  const entries: Entry[] = []
  const pendingToolUse = new Map<string, { name: string; input: unknown; timestamp: number }>()

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue

    let record: TranscriptRecord
    try {
      record = JSON.parse(line)
    } catch {
      continue // a malformed or truncated line shouldn't take down the whole parse
    }

    if (record.isSidechain) continue

    if (isCompactionBoundary(record)) {
      entries.length = 0
      pendingToolUse.clear()
      continue
    }

    const timestamp = toTimestampMs(record.timestamp)
    const content = record.message?.content

    if (record.type === 'user' && typeof content === 'string') {
      entries.push({ id: record.uuid ?? `user-${timestamp}`, role: 'user', content: excerpt(content), timestamp })
      continue
    }

    if (!Array.isArray(content)) continue

    for (const [index, raw] of content.entries()) {
      const block = asKnownBlock(raw)
      if (!block) continue

      // A user turn's content is array-shaped whenever it carries more than plain text (an
      // attachment alongside a text block, for example) — its text block still belongs in the
      // entry list the same way a plain-string user message does.
      if (block.type === 'text' && (record.type === 'assistant' || record.type === 'user')) {
        entries.push({
          id: `${record.uuid ?? timestamp}:text:${index}`,
          role: record.type === 'user' ? 'user' : 'assistant',
          content: excerpt(block.text),
          timestamp,
        })
      } else if (block.type === 'tool_use') {
        pendingToolUse.set(block.id, { name: block.name, input: block.input, timestamp })
      } else if (block.type === 'tool_result') {
        const pending = pendingToolUse.get(block.tool_use_id)
        pendingToolUse.delete(block.tool_use_id)
        const name = pending?.name ?? 'unknown_tool'
        const resultText = toolResultText(block.content)
        entries.push({
          id: block.tool_use_id,
          role: 'tool',
          toolName: name,
          content: toolExcerpt(`${toolLabel(name, pending?.input)}${block.is_error ? ' [error]' : ''}: ${resultText}`),
          timestamp: pending?.timestamp ?? timestamp,
        })
      }
    }
  }

  // A tool_use that never received its tool_result (the transcript ends mid-call — a crash, a
  // truncated log, a hook error) still occupied real context-window space; drop it from the
  // entry list entirely and PreCompact would silently forget it existed.
  for (const [toolUseId, pending] of pendingToolUse) {
    entries.push({
      id: toolUseId,
      role: 'tool',
      toolName: pending.name,
      content: toolExcerpt(`${toolLabel(pending.name, pending.input)}: (no result — tool call never completed)`),
      timestamp: pending.timestamp,
    })
  }

  return entries
}

/** When the session this transcript belongs to started — the first record carrying a timestamp. */
export function transcriptStartTime(jsonl: string): number | undefined {
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    try {
      const ms = toTimestampMs((JSON.parse(line) as TranscriptRecord).timestamp)
      if (ms > 0) return ms
    } catch {
      // skip malformed lines, same as parseClaudeCodeTranscript
    }
  }
  return undefined
}

/** A real slash command's own token has no further "/" or whitespace in it, e.g. "/compact" or
 * "/ctxjev:set-goal" — unlike a path or shell command a user might type mid-sentence, such as
 * "/etc/hosts isn't being read correctly", whose first token contains a second "/" and so never
 * matches. */
const SLASH_COMMAND_TOKEN = /^\/[a-zA-Z][\w-]*(:[\w-]+)*$/

function isSlashCommand(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed.includes('<command-name>')) return true

  const words = trimmed.split(/\s+/)
  // A bare command like "/compact" or "/clear" is the entire message, nothing else. A message
  // with more words after a slash-shaped first token ("/deploy the hotfix now") is ambiguous
  // between real command arguments and an ordinary sentence that starts with a slash-prefixed
  // word — real invocations that take arguments show up wrapped in <command-name> instead
  // (handled above), so don't guess here.
  return words.length === 1 && SLASH_COMMAND_TOKEN.test(words[0])
}

// Shorter than this, a message is usually an acknowledgment ("yes", "go ahead", "続けて"), not a
// description of the work — a bad thing to score the whole session against.
const MIN_GOAL_LENGTH = 20

/**
 * A fallback goal when none was set explicitly: the most recent user message that actually
 * describes something. Slash commands (`/compact`, ...) are skipped — `PreCompact` fires right
 * after one — and so are short acknowledgments, unless nothing longer exists, in which case the
 * most recent non-command message is still better than no goal at all.
 */
export function inferGoalFromEntries(entries: Entry[]): string | undefined {
  const candidates = [...entries].reverse().filter((e) => e.role === 'user' && !isSlashCommand(e.content))
  return (candidates.find((e) => e.content.trim().length >= MIN_GOAL_LENGTH) ?? candidates[0])?.content
}
