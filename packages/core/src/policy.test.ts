import { describe, expect, it } from 'vitest'
import { decideAction } from './policy.js'
import { DEFAULT_POLICY } from './types.js'

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
