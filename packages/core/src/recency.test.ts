import { describe, expect, it } from 'vitest'
import { computeRecency } from './recency.js'
import type { Entry } from './types.js'

function entry(id: string, timestamp: number): Entry {
  return { id, role: 'tool', content: 'x', timestamp }
}

describe('computeRecency', () => {
  it('maps the oldest entry to 0 and the newest to 1', () => {
    const recency = computeRecency([entry('old', 0), entry('mid', 50), entry('new', 100)])
    expect(recency.get('old')).toBe(0)
    expect(recency.get('mid')).toBe(0.5)
    expect(recency.get('new')).toBe(1)
  })

  it('gives every entry recency 1 when all timestamps are equal', () => {
    const recency = computeRecency([entry('a', 42), entry('b', 42)])
    expect(recency.get('a')).toBe(1)
    expect(recency.get('b')).toBe(1)
  })

  it('returns an empty map for no entries', () => {
    expect(computeRecency([]).size).toBe(0)
  })

  it('is order-independent — input order does not affect min/max detection', () => {
    const recency = computeRecency([entry('new', 100), entry('old', 0)])
    expect(recency.get('old')).toBe(0)
    expect(recency.get('new')).toBe(1)
  })
})
