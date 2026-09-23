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
    expect(rankForPreservation(scored, entries, 'something else', 5).map((s) => [s.entryId, s.content])).toEqual([
      ['goal', 'fix the double charge'],
      ['a', 'the retry handler re-charges'],
      ['b', 'unrelated listing'],
    ])
  })

  it('leaves out the message the goal itself came from', () => {
    expect(rankForPreservation(scored, entries, 'fix the double charge', 5).map((s) => s.entryId)).toEqual(['a', 'b'])
  })

  it('respects the limit', () => {
    expect(rankForPreservation(scored, entries, 'x', 1)).toHaveLength(1)
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
