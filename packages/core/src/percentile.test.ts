import { describe, expect, it } from 'vitest'
import { percentileRanks } from './percentile.js'

describe('percentileRanks', () => {
  it('maps distinct values onto 0..1 by rank, keeping their order', () => {
    expect(percentileRanks([0.3, 0.05, 0.1])).toEqual([1, 0, 0.5])
  })

  it("gives a tie group its members' average rank by default, its lowest member's with 'min'", () => {
    expect(percentileRanks([0, 0, 0, 0.2, 0.5])).toEqual([0.25, 0.25, 0.25, 0.75, 1])
    expect(percentileRanks([0, 0, 0, 0.2, 0.5], 'min')).toEqual([0, 0, 0, 0.75, 1])
  })

  it('ranks a single value, or all-equal values, at 1', () => {
    expect(percentileRanks([0.1])).toEqual([1])
    expect(percentileRanks([0, 0, 0])).toEqual([1, 1, 1])
    expect(percentileRanks([])).toEqual([])
  })
})
