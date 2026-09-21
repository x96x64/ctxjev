import { describe, expect, it } from 'vitest'
import { describePolicyOrderingError, parseThreshold } from './validation.js'

describe('parseThreshold', () => {
  it('accepts a number in [0, 1]', () => {
    expect(parseThreshold('0.25')).toBe(0.25)
    expect(parseThreshold('0')).toBe(0)
    expect(parseThreshold('1')).toBe(1)
  })

  it('rejects out-of-range numbers', () => {
    expect(parseThreshold('1.5')).toBeUndefined()
    expect(parseThreshold('-0.1')).toBeUndefined()
  })

  it('rejects non-numeric input', () => {
    expect(parseThreshold('abc')).toBeUndefined()
  })

  it('rejects an empty or whitespace-only string instead of silently reading it as 0', () => {
    expect(parseThreshold('')).toBeUndefined()
    expect(parseThreshold('   ')).toBeUndefined()
  })
})

describe('describePolicyOrderingError', () => {
  it('returns undefined when dropBelow <= summarizeBelow', () => {
    expect(describePolicyOrderingError(0.25, 0.6)).toBeUndefined()
    expect(describePolicyOrderingError(0.5, 0.5)).toBeUndefined()
  })

  it('describes the error when dropBelow > summarizeBelow', () => {
    expect(describePolicyOrderingError(0.9, 0.1)).toContain('must not be greater than')
  })
})
