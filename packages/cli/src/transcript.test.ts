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
})
