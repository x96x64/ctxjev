import { describe, expect, it } from 'vitest'
import { pruneContext, scoreEntries } from './index.js'
import type { ScoreCache } from './cache.js'
import type { Entry } from './types.js'

/**
 * Hits the real Jev API — skipped automatically unless TYPESAFE_API_KEY is set, so cloning
 * this repo and running `pnpm test` without a key still passes (see chunk/policy/savings
 * tests for the pure-logic coverage that always runs).
 */
// Jev is probabilistic: a retry absorbs a borderline entry flipping once; a real regression fails every attempt.
describe.skipIf(!process.env.TYPESAFE_API_KEY)('pruneContext (live)', { retry: 2 }, () => {
  it('scores an obviously relevant entry higher than an obviously irrelevant one', async () => {
    const entries: Entry[] = [
      {
        id: 'relevant',
        role: 'tool',
        toolName: 'grep',
        content: 'grep "charge" in src/payments.ts, found chargeCustomer() called twice on retry',
        timestamp: 0,
      },
      {
        id: 'irrelevant',
        role: 'tool',
        toolName: 'read',
        content: 'read package.json, saw the dependency list',
        timestamp: 1,
      },
    ]

    const decisions = await pruneContext(entries, 'Fix a bug where checkout charges customers twice.')
    const byId = new Map(decisions.map((d) => [d.entryId, d]))

    expect(byId.get('relevant')!.relevance).toBeGreaterThan(byId.get('irrelevant')!.relevance)
  }, 20_000)

  it('skips the Jev request entirely on a full cache hit', async () => {
    const entries: Entry[] = [
      { id: 'e1', role: 'tool', toolName: 'bash', content: 'ran the test suite, all green', timestamp: 0 },
    ]
    const goal = 'ship the release'

    const store = new Map<string, number>()
    const cache: ScoreCache = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) }

    const usages: number[] = []
    await scoreEntries(entries, goal, undefined, { cache, onUsage: (u) => usages.push(u.inputTokens) })
    expect(usages[0]).toBeGreaterThan(0)
    expect(store.size).toBe(1)

    // Same goal, same entry content, different entry id — still a cache hit, since the key is
    // content-based rather than id-based.
    const secondEntries: Entry[] = [{ ...entries[0], id: 'different-id' }]
    const secondScored = await scoreEntries(secondEntries, goal, undefined, {
      cache,
      onUsage: (u) => usages.push(u.inputTokens),
    })

    expect(usages[1]).toBe(0)
    expect(secondScored[0].relevance).toBeGreaterThan(0)
  }, 20_000)
})
