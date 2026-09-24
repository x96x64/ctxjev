import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, pruneContext, type Entry } from './index.js'

/**
 * Locks in the result of the recencyWeight sweep in packages/core/eval/run.mjs: aggregate
 * accuracy against hand-labeled fixtures ties across recencyWeight 0-0.2, but a higher weight
 * measurably degrades the adversarial case (an early entry that's still critical) — the reason
 * DEFAULT_POLICY.recencyWeight stays at 0.1 rather than something larger. If this test starts
 * failing, either DEFAULT_POLICY regressed or Jev's own judgment on these fixtures shifted enough
 * to warrant re-running the full sweep, not just bumping the expectation here.
 */
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/sample-transcripts')

type Fixture = { name: string; goal: string; entries: Entry[]; groundTruth?: Record<string, boolean> }

function loadFixtures(): Fixture[] {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f, ...JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) }))
    .filter((f): f is Fixture & { groundTruth: Record<string, boolean> } => Boolean(f.groundTruth))
}

// Jev is probabilistic: a retry absorbs a borderline entry flipping once; a real regression fails every attempt.
describe.skipIf(!process.env.TYPESAFE_API_KEY)('DEFAULT_POLICY against hand-labeled fixtures (live)', { retry: 2 }, () => {
  const fixtures = loadFixtures()
  it('has at least one fixture with ground truth to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fixture of fixtures) {
    it(`${fixture.name}: never drops an entry ground truth marks relevant`, async () => {
      const decisions = await pruneContext(fixture.entries, fixture.goal, DEFAULT_POLICY, { scorer: 'jev' })
      const decisionByEntryId = new Map(decisions.map((d) => [d.entryId, d]))

      for (const [entryId, expectedRelevant] of Object.entries(fixture.groundTruth)) {
        if (!expectedRelevant) continue
        const decision = decisionByEntryId.get(entryId)
        expect(decision?.action, `${fixture.name}/${entryId} should not be dropped`).not.toBe('drop')
      }
    }, 20_000)
  }
})
