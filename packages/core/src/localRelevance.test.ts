import { describe, expect, it } from 'vitest'
import { localRelevance } from './localRelevance.js'

describe('localRelevance', () => {
  const goal = 'Fix a bug where checkout charges customers twice on a slow network retry.'

  it('scores an entry sharing the goal’s key words above one that shares none', () => {
    const related = localRelevance(goal, 'grep "charge" in src/payments.ts — chargeCustomer() called from the retry handler')
    const unrelated = localRelevance(goal, 'ran: ls public/audio — was checking something else')
    expect(related).toBeGreaterThan(unrelated)
    expect(unrelated).toBe(0)
  })

  it('matches across camelCase identifiers and simple word forms', () => {
    expect(localRelevance('charge customers', 'chargeCustomer()')).toBe(1)
    expect(localRelevance('charges', 'charged twice')).toBe(1)
    expect(localRelevance('charging', 'charge')).toBe(1)
  })

  it('stays within [0, 1]', () => {
    const score = localRelevance(goal, goal)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  it('returns 0 for a goal with no significant words', () => {
    expect(localRelevance('and the', 'anything')).toBe(0)
  })
})
