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
})
