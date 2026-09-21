import { describe, expect, it } from 'vitest'
import { combineScore, decideAction } from './policy.js'
import { DEFAULT_POLICY } from './types.js'

describe('combineScore', () => {
  it('returns pure relevance when recencyWeight is 0', () => {
    expect(combineScore(0.7, 0.1, 0)).toBeCloseTo(0.7)
  })

  it('returns pure recency when recencyWeight is 1', () => {
    expect(combineScore(0.7, 0.1, 1)).toBeCloseTo(0.1)
  })

  it('blends proportionally at intermediate weights', () => {
    expect(combineScore(1, 0, 0.5)).toBeCloseTo(0.5)
  })
})

describe('decideAction', () => {
  it('drops entries below dropBelow', () => {
    expect(decideAction(0.1, DEFAULT_POLICY)).toBe('drop')
  })

  it('summarizes entries between dropBelow and summarizeBelow', () => {
    expect(decideAction(0.4, DEFAULT_POLICY)).toBe('summarize')
  })

  it('keeps entries at or above summarizeBelow', () => {
    expect(decideAction(0.9, DEFAULT_POLICY)).toBe('keep')
  })

  it('treats the boundaries as exclusive on the lower side', () => {
    expect(decideAction(DEFAULT_POLICY.dropBelow, DEFAULT_POLICY)).toBe('summarize')
    expect(decideAction(DEFAULT_POLICY.summarizeBelow, DEFAULT_POLICY)).toBe('keep')
  })
})
