import { describe, expect, it } from 'vitest'
import { pruneContext } from './index.js'
import type { Entry } from './types.js'

/**
 * Hits the real Jev API — skipped automatically unless TYPESAFE_API_KEY is set, so cloning
 * this repo and running `pnpm test` without a key still passes (see chunk/policy/savings
 * tests for the pure-logic coverage that always runs).
 */
describe.skipIf(!process.env.TYPESAFE_API_KEY)('pruneContext (live)', () => {
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
})
