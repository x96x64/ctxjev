import { describe, expect, it } from 'vitest'
import { estimateCostUsd } from './cost.js'

describe('estimateCostUsd', () => {
  it('charges only for input tokens, at $0.042/M', () => {
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 999_999 })).toBeCloseTo(0.042)
  })

  it('returns 0 for no usage', () => {
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0 })).toBe(0)
  })
})
