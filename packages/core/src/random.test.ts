import { describe, expect, it } from 'vitest'
import { seededRandom } from './random.js'

describe('seededRandom', () => {
  it('repeats the same sequence for the same seed, and stays in [0, 1)', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    const xs = Array.from({ length: 1000 }, () => a())
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()))
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(seededRandom(43)()).not.toBe(seededRandom(42)())
  })

  // The eval baselines (eval/run.mjs's random ranking, lib.mjs's bootstrap) were computed with this
  // exact generator; a change here would silently change every saved "random" and interval number.
  it('matches the generator the saved eval results were computed with', () => {
    const r = seededRandom(20260923)
    expect([r(), r(), r()].map((x) => x.toFixed(12))).toEqual(['0.260265859775', '0.044911657227', '0.702738767490'])
  })
})
