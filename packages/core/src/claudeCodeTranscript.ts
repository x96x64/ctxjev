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
  uuid?: string
  timestamp?: string
  isSidechain?: boolean
  message?: { role: string; content: string | unknown[] }
}

function asKnownBlock(raw: unknown): KnownContentBlock | undefined {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) return undefined
  return raw as KnownContentBlock
}

const MAX_CONTENT_LENGTH = 300

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_CONTENT_LENGTH ? `${oneLine.slice(0, MAX_CONTENT_LENGTH - 1)}…` : oneLine
}

function toolResultText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content
  return content
    .map((block) => (block.type === 'text' ? block.text ?? '' : `[${block.type}]`))
    .filter(Boolean)
    .join(' ')
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

    const timestamp = toTimestampMs(record.timestamp)
    const content = record.message?.content

    if (record.type === 'user' && typeof content === 'string') {
      entries.push({ id: record.uuid ?? `user-${timestamp}`, role: 'user', content: truncate(content), timestamp })
      continue
    }

    if (!Array.isArray(content)) continue

    for (const [index, raw] of content.entries()) {
      const block = asKnownBlock(raw)
      if (!block) continue

      if (block.type === 'text' && record.type === 'assistant') {
        entries.push({
          id: `${record.uuid ?? timestamp}:text:${index}`,
          role: 'assistant',
          content: truncate(block.text),
          timestamp,
        })
      } else if (block.type === 'tool_use') {
        pendingToolUse.set(block.id, { name: block.name, input: block.input, timestamp })
      } else if (block.type === 'tool_result') {
        const pending = pendingToolUse.get(block.tool_use_id)
        const name = pending?.name ?? 'unknown_tool'
        const resultText = toolResultText(block.content)
        entries.push({
          id: block.tool_use_id,
          role: 'tool',
          toolName: name,
          content: truncate(`${name}: ${resultText}`),
          timestamp: pending?.timestamp ?? timestamp,
        })
      }
    }
  }

  return entries
}

/** The most recent user chat message, as a fallback goal when none was set explicitly. */
export function inferGoalFromEntries(entries: Entry[]): string | undefined {
  return [...entries].reverse().find((e) => e.role === 'user')?.content
}
