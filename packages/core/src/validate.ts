import type { AnthropicMessage } from './anthropicMessages.js'
import type { Entry, EntryRole, PruningPolicy } from './types.js'

/**
 * Checks on what callers pass in, so a malformed input fails with a message naming the field
 * instead of a raw TypeError from deep inside, or a NaN that turns into "keep everything" or a
 * "NaN%" report. Types stop a TypeScript caller; these stop JSON from a file, an MCP client, or
 * JavaScript.
 */
const ROLES: EntryRole[] = ['user', 'assistant', 'tool']

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function validateEntry(entry: unknown, where: string): asserts entry is Entry {
  if (!isObject(entry)) throw new Error(`${where} must be an object`)
  const { id, role, toolName, content, timestamp, sourceTokens } = entry
  if (typeof id !== 'string' || id.length === 0) throw new Error(`${where}.id must be a non-empty string`)
  if (typeof role !== 'string' || !ROLES.includes(role as EntryRole)) throw new Error(`${where}.role must be one of ${ROLES.join(', ')}`)
  if (toolName !== undefined && typeof toolName !== 'string') throw new Error(`${where}.toolName must be a string when present`)
  if (typeof content !== 'string') throw new Error(`${where}.content must be a string`)
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) throw new Error(`${where}.timestamp must be a finite number`)
  if (sourceTokens !== undefined && (typeof sourceTokens !== 'number' || !Number.isFinite(sourceTokens) || sourceTokens < 0)) {
    throw new Error(`${where}.sourceTokens must be a non-negative number when present`)
  }
}

export function validateEntries(entries: unknown, where = 'entries'): asserts entries is Entry[] {
  if (!Array.isArray(entries)) throw new Error(`${where} must be an array`)
  entries.forEach((entry, i) => validateEntry(entry, `${where}[${i}]`))
}

export function validateGoal(goal: unknown): asserts goal is string {
  if (typeof goal !== 'string') throw new Error(`goal must be a string, got ${goal === null ? 'null' : typeof goal}`)
}

export function validatePolicy(policy: PruningPolicy): void {
  if (!isObject(policy)) throw new Error('policy must be an object with dropBelow, summarizeBelow, and recencyWeight')
  for (const key of ['dropBelow', 'summarizeBelow', 'recencyWeight'] as const) {
    const value: unknown = policy[key]
    if (typeof value !== 'number' || !(value >= 0 && value <= 1)) throw new Error(`policy.${key} must be a number from 0 to 1, got ${String(value)}`)
  }
  if (policy.dropBelow > policy.summarizeBelow) {
    throw new Error(`policy.dropBelow (${policy.dropBelow}) must not be greater than summarizeBelow (${policy.summarizeBelow})`)
  }
}

export function validateRecencyWeight(recencyWeight: unknown): void {
  if (typeof recencyWeight !== 'number' || !(recencyWeight >= 0 && recencyWeight <= 1)) throw new Error(`recencyWeight must be a number from 0 to 1, got ${String(recencyWeight)}`)
}

/** A block in a message or in a tool_result's content: what ctxjev reads from it must be there. */
function validateBlock(block: unknown, where: string, nested: boolean): void {
  if (!isObject(block) || typeof block.type !== 'string') throw new Error(`${where} must be an object with a string "type"`)
  if (block.type === 'text' && typeof block.text !== 'string') throw new Error(`${where}.text must be a string`)
  if (nested) return
  if (block.type === 'tool_use') {
    if (typeof block.id !== 'string') throw new Error(`${where}.id must be a string`)
    if (typeof block.name !== 'string') throw new Error(`${where}.name must be a string`)
  } else if (block.type === 'tool_result') {
    if (typeof block.tool_use_id !== 'string') throw new Error(`${where}.tool_use_id must be a string`)
    const { content } = block
    if (content === undefined || typeof content === 'string') return
    if (!Array.isArray(content)) throw new Error(`${where}.content must be a string or an array of blocks`)
    content.forEach((inner, i) => validateBlock(inner, `${where}.content[${i}]`, true))
  }
}

export function validateMessages(messages: unknown): asserts messages is AnthropicMessage[] {
  if (!Array.isArray(messages)) throw new Error('messages must be an array')
  messages.forEach((message, m) => {
    const where = `messages[${m}]`
    if (!isObject(message)) throw new Error(`${where} must be an object`)
    if (message.role !== 'user' && message.role !== 'assistant') throw new Error(`${where}.role must be "user" or "assistant"`)
    const { content } = message
    if (typeof content === 'string') return
    if (!Array.isArray(content)) throw new Error(`${where}.content must be a string or an array of blocks`)
    content.forEach((block, b) => validateBlock(block, `${where}.content[${b}]`, false))
  })
}
