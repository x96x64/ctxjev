import { describe, expect, it } from 'vitest'
import { chunkEntries } from './chunk.js'
import type { Entry } from './types.js'

function makeEntries(count: number): Entry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    role: 'tool' as const,
    content: `entry ${i}`,
    timestamp: i,
  }))
}

describe('chunkEntries', () => {
  it('returns a single chunk when under the limit', () => {
    expect(chunkEntries(makeEntries(10), 50)).toHaveLength(1)
  })

  it('splits evenly-divisible input into exact-size chunks', () => {
    const chunks = chunkEntries(makeEntries(100), 50)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(50)
    expect(chunks[1]).toHaveLength(50)
  })

  it('puts the remainder in its own final chunk', () => {
    const chunks = chunkEntries(makeEntries(120), 50)
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20])
  })

  it('returns no chunks for empty input', () => {
    expect(chunkEntries([], 50)).toEqual([])
  })

  it('rejects a non-positive maxPerRequest instead of looping forever', () => {
    expect(() => chunkEntries(makeEntries(1), 0)).toThrow('maxPerRequest must be a positive number')
    expect(() => chunkEntries(makeEntries(1), -1)).toThrow('maxPerRequest must be a positive number')
  })
})
