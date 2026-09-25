import { describe, expect, it } from 'vitest'
import { parseTranscript } from './transcript.js'

describe('parseTranscript', () => {
  it('parses a well-formed transcript', () => {
    const raw = JSON.stringify({ goal: 'fix the bug', entries: [{ id: 'a', role: 'tool', content: 'x', timestamp: 0 }] })
    const parsed = parseTranscript(raw)
    expect(parsed.goal).toBe('fix the bug')
    expect(parsed.entries).toHaveLength(1)
  })

  it('allows an omitted goal', () => {
    const raw = JSON.stringify({ entries: [] })
    expect(parseTranscript(raw).goal).toBeUndefined()
  })

  it('rejects a missing entries array', () => {
    expect(() => parseTranscript(JSON.stringify({ goal: 'x' }))).toThrow(/entries/)
  })

  it('rejects entries that is not an array', () => {
    expect(() => parseTranscript(JSON.stringify({ entries: 'nope' }))).toThrow(/array/)
  })

  it('rejects a non-string goal', () => {
    expect(() => parseTranscript(JSON.stringify({ goal: 42, entries: [] }))).toThrow(/goal/)
  })

  it('rejects an entry missing a timestamp instead of letting it poison every score to NaN', () => {
    const raw = JSON.stringify({ goal: 'x', entries: [{ id: 'a', role: 'tool', content: 'x' }] })
    expect(() => parseTranscript(raw)).toThrow(/entries\[0\]\.timestamp/)
  })

  it('rejects an entry with an invalid role', () => {
    const raw = JSON.stringify({ goal: 'x', entries: [{ id: 'a', role: 'robot', content: 'x', timestamp: 0 }] })
    expect(() => parseTranscript(raw)).toThrow(/entries\[0\]\.role/)
  })

  it('rejects an entry with a non-string content', () => {
    const raw = JSON.stringify({ goal: 'x', entries: [{ id: 'a', role: 'tool', content: 42, timestamp: 0 }] })
    expect(() => parseTranscript(raw)).toThrow(/entries\[0\]\.content/)
  })

  it('rejects an entry with an empty id', () => {
    const raw = JSON.stringify({ goal: 'x', entries: [{ id: '', role: 'tool', content: 'x', timestamp: 0 }] })
    expect(() => parseTranscript(raw)).toThrow(/entries\[0\]\.id/)
  })

  it('falls back to parsing a Claude Code .jsonl transcript when the whole file is not one JSON document', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the bug' } }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'found it' }] },
      }),
    ].join('\n')

    const parsed = parseTranscript(jsonl)
    expect(parsed.goal).toBe('fix the bug')
    expect(parsed.entries).toHaveLength(2)
  })

  it('throws a clear error when a file parses as neither format', () => {
    expect(() => parseTranscript('not json at all\nstill not json')).toThrow(/could not parse/)
  })

  it('reports where a broken JSON file breaks, instead of guessing it is a .jsonl', () => {
    expect(() => parseTranscript('{"goal": "x", "entries": [{"id": "a", "role": "tool"')).toThrow(/could not parse.*not valid JSON.*ends before the JSON does/s)
    expect(() => parseTranscript('{\n  "goal": "x",\n  "entries": [,]\n}')).toThrow(/line 3, column 15/)
  })

  it('parses a Claude Code transcript with a repeated uuid, keeping the last and warning', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the bug in checkout' } }),
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'fix the bug in checkout, please' } }),
    ].join('\n')
    const parsed = parseTranscript(jsonl)
    expect(parsed.entries.map((e) => e.id)).toEqual(['u1'])
    expect(parsed.format === 'claude-code' && parsed.warnings).toEqual([expect.stringContaining('"u1"')])
  })

  it('detects a bare Anthropic Messages array and infers the goal from it', () => {
    const raw = JSON.stringify([
      { role: 'user', content: 'Checkout charges customers twice on a slow retry, please fix' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'charge' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'found it' }] },
    ])
    const parsed = parseTranscript(raw)
    expect(parsed.format).toBe('anthropic-messages')
    expect(parsed.goal).toBe('Checkout charges customers twice on a slow retry, please fix')
    expect(parsed.entries.map((e) => e.id)).toEqual(['msg:0', 'tool:t1'])
    expect(parsed.format === 'anthropic-messages' && parsed.wrapped).toBe(false)
  })

  it('detects a wrapped { goal, messages } conversation and keeps its goal', () => {
    const parsed = parseTranscript(JSON.stringify({ goal: 'the goal', messages: [{ role: 'user', content: 'hi' }] }))
    expect(parsed.format).toBe('anthropic-messages')
    expect(parsed.goal).toBe('the goal')
    expect(parsed.format === 'anthropic-messages' && parsed.wrapped).toBe(true)
  })

  it('rejects a message with an invalid role', () => {
    expect(() => parseTranscript(JSON.stringify([{ role: 'system', content: 'x' }]))).toThrow(/messages\[0\]\.role/)
  })
})
