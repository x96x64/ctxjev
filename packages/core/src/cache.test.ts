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

  it('treats a missing toolName and an empty-string toolName as the same key', () => {
    const a = cacheKeyFor('g', { role: 'tool' as const, toolName: undefined, content: 'x' })
    const b = cacheKeyFor('g', { role: 'tool' as const, toolName: '', content: 'x' })
    expect(a).toBe(b) // both normalize toolName to '', and that's fine — this asserts it's deliberate, not accidental
  })

  it('changes with the latest activity, since that can change the verdict', () => {
    const entry = { role: 'tool' as const, toolName: 'Bash', content: 'npm test: 1 failed' }
    const fixed = [{ role: 'tool' as const, toolName: 'Bash', content: 'npm test: all passed' }]
    expect(cacheKeyFor('g', entry, fixed)).not.toBe(cacheKeyFor('g', entry))
    expect(cacheKeyFor('g', entry, fixed)).toBe(cacheKeyFor('g', entry, [...fixed]))
  })

  // Keys end up on disk (ctxjev-cli's ~/.cache/ctxjev/score-cache.json); the audit found goals and
  // entry content — secrets included, since ctxjev-format content isn't masked — stored there as-is.
  it('is a SHA-256 digest, so neither the goal nor the content is stored in it', () => {
    const key = cacheKeyFor('rotate S3cretPassw0rd', { role: 'tool', toolName: 'Bash', content: 'export PW=S3cretPassw0rd' })
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain('S3cret')
  })
})
