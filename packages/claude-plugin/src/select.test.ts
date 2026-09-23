import type { Entry, ScoredEntry } from 'ctxjev-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESERVE_LIMIT, preserveLimitFromEnv, rankForPreservation, selectPreserved } from './select.js'

const entries: Entry[] = [
  { id: 'goal', role: 'user', content: 'fix the double charge', timestamp: 0 },
  { id: 'a', role: 'tool', content: 'the retry handler re-charges', timestamp: 1 },
  { id: 'b', role: 'tool', content: 'unrelated listing', timestamp: 2 },
]

const scored: ScoredEntry[] = [
  { entryId: 'goal', relevance: 0.99, recency: 0, combinedScore: 0.99 },
  { entryId: 'a', relevance: 0.9, recency: 0.5, combinedScore: 0.86 },
  { entryId: 'b', relevance: 0.1, recency: 1, combinedScore: 0.19 },
]

describe('selectPreserved', () => {
  it('returns an empty array for no entries without calling Jev', async () => {
    expect(await selectPreserved([], 'goal')).toEqual([])
  })
})

describe('rankForPreservation', () => {
  it('ranks by combined score and carries each entry’s content', () => {
    expect(rankForPreservation(scored, entries, 'something else', 5, Number.MIN_VALUE).map((s) => [s.entryId, s.content])).toEqual([
      ['goal', 'fix the double charge'],
      ['a', 'the retry handler re-charges'],
      ['b', 'unrelated listing'],
    ])
  })

  it('leaves out the message the goal itself came from', () => {
    expect(rankForPreservation(scored, entries, 'fix the double charge', 5, Number.MIN_VALUE).map((s) => s.entryId)).toEqual(['a', 'b'])
  })

  it('respects the limit', () => {
    expect(rankForPreservation(scored, entries, 'x', 1, Number.MIN_VALUE)).toHaveLength(1)
  })

  it('leaves out entries with zero relevance, however recent', () => {
    const withZero: ScoredEntry[] = [...scored.slice(0, 2), { entryId: 'b', relevance: 0, recency: 1, combinedScore: 0.1 }]
    expect(rankForPreservation(withZero, entries, 'x', 5, Number.MIN_VALUE).map((s) => s.entryId)).toEqual(['goal', 'a'])
  })

  it('leaves out entries below the minimum relevance, even when that leaves slots empty', () => {
    // b's relevance (0.1) is below 0.25, even though recency pushes its combined score up
    expect(rankForPreservation(scored, entries, 'x', 5, 0.25).map((s) => s.entryId)).toEqual(['goal', 'a'])
  })
})

describe('preserveLimitFromEnv', () => {
  it('accepts a whole number from 1 to 50', () => {
    expect(preserveLimitFromEnv('10')).toBe(10)
  })

  it('falls back to the default for anything else', () => {
    for (const raw of [undefined, '', '0', '-3', '2.5', '51', 'lots']) {
      expect(preserveLimitFromEnv(raw)).toBe(DEFAULT_PRESERVE_LIMIT)
    }
  })
})

describe('rankForPreservation, acknowledgments', () => {
  it('leaves out a short user acknowledgment even when it scores high', () => {
    const withAck: Entry[] = [...entries, { id: 'ack', role: 'user', content: 'yes go ahead', timestamp: 3 }]
    const withAckScored: ScoredEntry[] = [...scored, { entryId: 'ack', relevance: 0.8, recency: 1, combinedScore: 0.82 }]
    expect(rankForPreservation(withAckScored, withAck, 'x', 5, Number.MIN_VALUE).map((s) => s.entryId)).not.toContain('ack')
  })

  it('leaves out a command the user ran, such as the /ctxjev:set-goal that set the goal', () => {
    const content = '<command-name>/ctxjev:set-goal</command-name> <command-args>Stop the double charge on retry</command-args>'
    const withCommand: Entry[] = [...entries, { id: 'cmd', role: 'user', content, timestamp: 3 }]
    const withCommandScored: ScoredEntry[] = [...scored, { entryId: 'cmd', relevance: 1, recency: 1, combinedScore: 1 }]
    expect(rankForPreservation(withCommandScored, withCommand, 'Stop the double charge on retry', 5, Number.MIN_VALUE).map((s) => s.entryId)).not.toContain('cmd')
  })
})
