import { describe, expect, it } from 'vitest'
import { inferGoalFromEntries, parseClaudeCodeTranscript } from './claudeCodeTranscript.js'

function record(obj: unknown): string {
  return JSON.stringify(obj)
}

describe('parseClaudeCodeTranscript', () => {
  it('extracts a plain user chat message', () => {
    const jsonl = record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the bug' } })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toEqual([{ id: 'u1', role: 'user', content: 'fix the bug', timestamp: Date.parse('2026-01-01T00:00:00.000Z') }])
  })

  it('extracts an assistant text reply', () => {
    const jsonl = record({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'found it' }] },
    })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toEqual([{ id: 'a1:text:0', role: 'assistant', content: 'found it', timestamp: Date.parse('2026-01-01T00:00:01.000Z') }])
  })

  it('combines a tool_use with its matching tool_result into one entry', () => {
    const jsonl = [
      record({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call1', name: 'Bash', input: { command: 'npm test' } }] },
      }),
      record({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: '12 passed' }] },
      }),
    ].join('\n')

    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'call1', role: 'tool', toolName: 'Bash', content: 'Bash: 12 passed' })
    // uses the tool_use's own timestamp, not the later tool_result's
    expect(entries[0].timestamp).toBe(Date.parse('2026-01-01T00:00:01.000Z'))
  })

  it('handles array-shaped tool_result content (multiple text blocks)', () => {
    const jsonl = [
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call1', name: 'Read', input: {} }] } }),
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: [{ type: 'text', text: 'line one' }] }] } }),
    ].join('\n')

    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries[0].content).toBe('Read: line one')
  })

  it('falls back to "unknown_tool" when a tool_result has no matching tool_use', () => {
    const jsonl = record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'x' }] } })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries[0].toolName).toBe('unknown_tool')
  })

  it('skips thinking blocks, non-array/non-string content, and unrelated record types', () => {
    const jsonl = [
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal reasoning' }] } }),
      record({ type: 'queue-operation', operation: 'enqueue' }),
      record({ type: 'attachment', attachment: { type: 'environment' } }),
    ].join('\n')

    expect(parseClaudeCodeTranscript(jsonl)).toEqual([])
  })

  it('skips sidechain records entirely (subagent private conversation)', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'main thread message' } }),
      record({ type: 'user', uuid: 'u2', isSidechain: true, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'subagent-internal message' } }),
      record({
        type: 'assistant',
        uuid: 'a1',
        isSidechain: true,
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'subagent-internal reply' }] },
      }),
    ].join('\n')

    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toHaveLength(1)
    expect(entries[0].content).toBe('main thread message')
  })

  it('skips malformed lines without throwing', () => {
    const jsonl = ['not json', record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'ok' } })].join('\n')
    expect(() => parseClaudeCodeTranscript(jsonl)).not.toThrow()
    expect(parseClaudeCodeTranscript(jsonl)).toHaveLength(1)
  })

  it('truncates long content to a short excerpt', () => {
    const longText = 'x'.repeat(500)
    const jsonl = record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: longText } })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries[0].content.length).toBeLessThan(310)
    expect(entries[0].content.endsWith('…')).toBe(true)
  })
})

describe('inferGoalFromEntries', () => {
  it('returns the most recent user entry', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'first' } }),
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: 'latest' } }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('latest')
  })

  it('returns undefined when there is no user entry', () => {
    const jsonl = record({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'reply only' }] },
    })
    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBeUndefined()
  })

  it('skips a trailing bare slash command like /compact', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the checkout bug' } }),
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: '/compact' } }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('fix the checkout bug')
  })

  it('skips a wrapped skill-command invocation', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the checkout bug' } }),
      record({
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: '<command-message>ctxjev:status</command-message> <command-name>/ctxjev:status</command-name>' },
      }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('fix the checkout bug')
  })

  it('returns undefined when every user entry is a slash command', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: '/clear' } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: '/compact' } }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBeUndefined()
  })
})
