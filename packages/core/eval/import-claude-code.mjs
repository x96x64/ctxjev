#!/usr/bin/env node
/**
 * Converts a Claude Code session recorded by examples/eval-tasks/record.mjs into an eval session:
 * an Anthropic Messages conversation in examples/eval-sessions/recorded-<task>.json.
 *
 * Only real conversation survives: user text, assistant text, and tool calls with their results.
 * Attachments (environment and account snapshots, system prompts), thinking, sidechains, meta
 * records, <system-reminder> text, and Claude Code's own ToolSearch calls are dropped. Consecutive
 * records of one role become one message, the way the API would see them. The repo path becomes
 * /workspace/<task>, other home-directory paths and the account's email are replaced, and
 * everything goes through redactSecrets(). Read the output before committing it anyway.
 *
 * Labels and probes are not written here. They're added by hand afterwards, and a re-import keeps
 * any that already exist for ids that still exist.
 *
 * Usage: node eval/import-claude-code.mjs <task> <transcript.jsonl> <recorded repo path>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { messagesToEntries, redactSecrets } from '../dist/index.js'

const [task, transcriptPath, repoPath] = process.argv.slice(2)
if (!task || !transcriptPath || !repoPath) {
  console.error('usage: import-claude-code.mjs <task> <transcript.jsonl> <recorded repo path>')
  process.exit(1)
}
const examples = join(dirname(fileURLToPath(import.meta.url)), '../../../examples')
const taskSpec = JSON.parse(readFileSync(join(examples, 'eval-tasks', task, 'task.json'), 'utf8'))
const INTERNAL_TOOLS = new Set(['ToolSearch'])

const user = userInfo().username
const replacements = [
  // macOS reports /tmp paths both with and without /private; replace the longer form first.
  [repoPath.startsWith('/private') ? repoPath : `/private${repoPath}`, `/workspace/${task}`],
  [repoPath.replace(/^\/private/, ''), `/workspace/${task}`],
  [homedir(), '/home/dev'],
  [new RegExp(`-Users-${user}\\b`, 'g'), '-home-dev'],
  [new RegExp(`\\b${user}\\b`, 'g'), 'dev'],
  [/[\w.+-]+@(?!example\.com\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, 'dev@example.com'],
  // Claude Code saves oversized tool output under a directory named after the escaped cwd.
  [/\.claude\/projects\/[^/\s]+\//g, `.claude/projects/-workspace-${task}/`],
]
function clean(text) {
  let out = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  for (const [from, to] of replacements) out = typeof from === 'string' ? out.split(from).join(to) : out.replace(from, to)
  return redactSecrets(out)
}

function resultText(content) {
  if (typeof content === 'string') return clean(content)
  return clean(content.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n'))
}

const messages = []
const droppedToolIds = new Set()
for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
  if (!line.trim()) continue
  const record = JSON.parse(line)
  if ((record.type !== 'user' && record.type !== 'assistant') || record.isSidechain || record.isMeta || record.isCompactSummary) continue
  const content = record.message?.content
  const blocks = []
  if (typeof content === 'string') {
    const text = clean(content).trim()
    if (text) blocks.push({ type: 'text', text })
  } else if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'text') {
        const text = clean(b.text).trim()
        if (text) blocks.push({ type: 'text', text })
      } else if (b.type === 'tool_use') {
        if (INTERNAL_TOOLS.has(b.name)) droppedToolIds.add(b.id)
        else blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: JSON.parse(clean(JSON.stringify(b.input))) })
      } else if (b.type === 'tool_result') {
        if (!droppedToolIds.has(b.tool_use_id)) blocks.push({ type: 'tool_result', tool_use_id: b.tool_use_id, content: resultText(b.content ?? ''), ...(b.is_error && { is_error: true }) })
      }
    }
  }
  if (blocks.length === 0) continue
  const last = messages[messages.length - 1]
  if (last?.role === record.type) last.content.push(...blocks)
  else messages.push({ role: record.type, content: blocks })
}

// Plain-text user messages as strings, like a hand-written conversation.
for (const m of messages) if (m.role === 'user' && m.content.length === 1 && m.content[0].type === 'text') m.content = m.content[0].text

const fixPrompt = clean(taskSpec.prompts[taskSpec.prompts.length - 1]).trim()
const fixIndex = messages.findIndex((m) => m.role === 'user' && (typeof m.content === 'string' ? m.content : m.content.map((b) => b.text ?? '').join('')).includes(fixPrompt))
if (fixIndex < 0) throw new Error('could not find the fix prompt in the transcript')

const out = join(examples, 'eval-sessions', `recorded-${task}.json`)
const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {}
const ids = new Set(messagesToEntries(messages).map((e) => e.id))
const labels = Object.fromEntries(Object.entries(previous.labels ?? {}).filter(([id]) => ids.has(id)))

writeFileSync(
  out,
  `${JSON.stringify({ language: taskSpec.language, recorded: true, task, goal: clean(taskSpec.goal), cutAfterMessage: fixIndex - 1, messages, labels, probes: previous.probes ?? [] }, null, 1)}\n`,
)
const entries = messagesToEntries(messages)
console.log(`${out}: ${messages.length} messages, ${entries.length} entries, ${entries.reduce((s, e) => s + e.sourceTokens, 0)} tokens; history before the fix prompt: messages 0-${fixIndex - 1}`)
