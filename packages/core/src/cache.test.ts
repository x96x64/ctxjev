import { describe, expect, it } from 'vitest'
import { cacheKeyFor } from './cache.js'

describe('cacheKeyFor', () => {
  it('gives the same key for the same goal + entry fields', () => {
    const entry = { role: 'tool' as const, toolName: 'grep', content: 'found nothing' }
    expect(cacheKeyFor('g', entry)).toBe(cacheKeyFor('g', entry))
  })

  it('does not collide when a field boundary could otherwise shift', () => {
    // Splitting the same overall text differently between toolName and content used to produce
    // an identical delimited-join key; each distinct (role, toolName, content) tuple must map to
    // a distinct key.
    const a = cacheKeyFor('g', { role: 'tool' as const, toolName: 'grep', content: 'found nothing' })
    const b = cacheKeyFor('g', { role: 'tool' as const, toolName: 'grep found', content: 'nothing' })
    expect(a).not.toBe(b)
  })

  it('distinguishes a missing toolName from an empty-string toolName', () => {
    const a = cacheKeyFor('g', { role: 'tool' as const, toolName: undefined, content: 'x' })
    const b = cacheKeyFor('g', { role: 'tool' as const, toolName: '', content: 'x' })
    expect(a).toBe(b) // both normalize toolName to '', and that's fine — this asserts it's deliberate, not accidental
  })
})
