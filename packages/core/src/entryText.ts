import { redactSecrets } from './redact.js'

// Shared by every parser that turns a conversation into entries (Claude Code transcripts,
// Anthropic Messages), so an entry reads the same whichever format it came from.

const MAX_CONTENT_LENGTH = 600

/** Collapses whitespace and clips to `max` chars with an ellipsis. */
export function truncate(text: string, max: number = MAX_CONTENT_LENGTH): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

// Shorter than this, a user message is usually an acknowledgment ("yes", "go ahead", "続けて"),
// not a description of the work.
const MIN_SUBSTANTIVE_LENGTH = 20

// CJK packs roughly twice the meaning per character as English, so each wide character counts
// double — otherwise "ログイン画面のバグを直して" (13 chars) would read as an acknowledgment.
const WIDE_CHAR = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\u3000-\u303f\uff00-\uffef]/gu

/** Whether a user message says something on its own, rather than acknowledging what came before. */
export function isSubstantiveMessage(text: string): boolean {
  const trimmed = text.trim()
  const wide = trimmed.match(WIDE_CHAR)?.length ?? 0
  return [...trimmed].length + wide >= MIN_SUBSTANTIVE_LENGTH
}

/** Masked before it's cut, so a secret straddling the cut can't survive as a partial match. */
export function excerpt(text: string): string {
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

export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: { type?: string; text?: string }) => (block?.type === 'text' ? block.text ?? '' : `[${block?.type ?? 'unknown'}]`))
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

/** One entry's content for a tool call and its result: `Bash(npm test) [error]: <output>`. */
export function toolEntryContent(name: string, input: unknown, result: { text: string; isError?: boolean } | undefined): string {
  if (!result) return toolExcerpt(`${toolLabel(name, input)}: (no result — tool call never completed)`)
  return toolExcerpt(`${toolLabel(name, input)}${result.isError ? ' [error]' : ''}: ${result.text}`)
}
