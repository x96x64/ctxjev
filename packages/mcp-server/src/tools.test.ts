import { describe, expect, it } from 'vitest'
import { createBoundedScoreCache } from './tools.js'

describe('createBoundedScoreCache', () => {
  it('evicts the least recently used key past its limit', () => {
    const cache = createBoundedScoreCache(2)
    cache.set('a', 0.1)
    cache.set('b', 0.2)
    expect(cache.get('a')).toBe(0.1) // a is now the most recently used
    cache.set('c', 0.3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(0.1)
    expect(cache.get('c')).toBe(0.3)
    expect(cache.size).toBe(2)
  })
})
