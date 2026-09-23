import { excerpt, isSubstantiveMessage, toolEntryContent, toolResultText } from './entryText.js'
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

export type ParseClaudeCodeTranscriptOptions = {
  /**
   * Fills in each entry's `sourceTokens` — pass `estimateTokens`. A parameter rather than a direct
   * import so the Claude Code plugin, which never shows token counts, doesn't bundle a tokenizer
   * (megabytes of encoding tables) or spend its PreCompact time budget running one.
   */
  countTokens?: (text: string) => number
}

export function parseClaudeCodeTranscript(jsonl: string, options: ParseClaudeCodeTranscriptOptions = {}): Entry[] {
  const { countTokens } = options
  const count = (text: string) => (countTokens ? { sourceTokens: countTokens(text) } : {})
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
      entries.push({ id: record.uuid ?? `user-${timestamp}`, role: 'user', content: excerpt(content), timestamp, ...count(content) })
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
          ...count(block.text),
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
          content: toolEntryContent(name, pending?.input, { text: resultText, isError: block.is_error }),
          timestamp: pending?.timestamp ?? timestamp,
          ...count(`${JSON.stringify(pending?.input ?? {})}${resultText}`),
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
      content: toolEntryContent(pending.name, pending.input, undefined),
      timestamp: pending.timestamp,
      ...count(JSON.stringify(pending.input ?? {})),
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

/**
 * A fallback goal when none was set explicitly: the first user message that describes something
 * (the task) plus the most recent one (where the work is now). The latest alone is usually a step
 * like "also check the tests", which aims scoring at the step instead of the task; in the plugin
 * eval, the combined goal passed every task and the latest-only one missed two of twenty.
 * Slash commands (`/compact`, ...) are skipped — `PreCompact` fires right after one — and so are
 * short acknowledgments, unless nothing longer exists, in which case the most recent non-command
 * message is still better than no goal at all.
 */
export function inferGoalFromEntries(entries: Entry[]): string | undefined {
  const candidates = entries.filter((e) => e.role === 'user' && !isSlashCommand(e.content))
  const substantive = candidates.filter((e) => isSubstantiveMessage(e.content))
  const latest = (substantive.at(-1) ?? candidates.at(-1))?.content
  const task = substantive[0]?.content
  return task && latest && task !== latest ? `${task}\n\nLatest instruction: ${latest}` : latest
}
