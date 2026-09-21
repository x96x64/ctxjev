import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { entrySchema, pruneHistoryInput, scoreRelevanceInput, validatePolicyOrdering } from './schemas.js'

const scoreRelevanceSchema = z.object(scoreRelevanceInput)
const pruneHistorySchema = z.object(pruneHistoryInput)

describe('entrySchema', () => {
  it('accepts a well-formed entry', () => {
    expect(entrySchema.safeParse({ id: 'e1', role: 'tool', toolName: 'grep', content: 'x', timestamp: 0 }).success).toBe(true)
  })

  it('rejects an empty id', () => {
    expect(entrySchema.safeParse({ id: '', role: 'user', content: 'x', timestamp: 0 }).success).toBe(false)
  })

  it('rejects content over the length cap', () => {
    const result = entrySchema.safeParse({ id: 'e1', role: 'user', content: 'x'.repeat(4001), timestamp: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-finite timestamp', () => {
    // Reachable over real JSON: JSON.parse('{"timestamp":1e400}') already produces Infinity.
    // core's computeRecency takes min/max across the whole batch, so one infinite timestamp
    // would otherwise turn every entry's recency into NaN, not just this one's.
    expect(entrySchema.safeParse({ id: 'e1', role: 'user', content: 'x', timestamp: Infinity }).success).toBe(false)
    expect(entrySchema.safeParse({ id: 'e1', role: 'user', content: 'x', timestamp: -Infinity }).success).toBe(false)
  })
})

describe('scoreRelevanceInput', () => {
  it('rejects an empty goal', () => {
    expect(scoreRelevanceSchema.safeParse({ goal: '', entries: [] }).success).toBe(false)
  })

  it('rejects more entries than the cap', () => {
    const entries = Array.from({ length: 501 }, (_, i) => ({ id: `e${i}`, role: 'user' as const, content: 'x', timestamp: i }))
    expect(scoreRelevanceSchema.safeParse({ goal: 'g', entries }).success).toBe(false)
  })

  it('rejects a recencyWeight outside [0, 1]', () => {
    expect(scoreRelevanceSchema.safeParse({ goal: 'g', entries: [], recencyWeight: 1.5 }).success).toBe(false)
  })
})

describe('validatePolicyOrdering', () => {
  it('accepts dropBelow <= summarizeBelow', () => {
    expect(() => validatePolicyOrdering(0.25, 0.6)).not.toThrow()
    expect(() => validatePolicyOrdering(0.5, 0.5)).not.toThrow()
  })

  it('rejects a reversed pair', () => {
    expect(() => validatePolicyOrdering(0.9, 0.1)).toThrow('must not be greater than')
  })
})

describe('pruneHistoryInput', () => {
  it('accepts dropBelow/summarizeBelow within [0, 1] at the schema level', () => {
    expect(pruneHistorySchema.safeParse({ goal: 'g', entries: [], dropBelow: 0.25, summarizeBelow: 0.6 }).success).toBe(true)
  })
})
