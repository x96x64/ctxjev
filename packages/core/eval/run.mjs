#!/usr/bin/env node
/**
 * Sweeps `recencyWeight` against hand-labeled fixtures (examples/sample-transcripts/*.json with a
 * `groundTruth` field: { entryId: boolean } — "should this ultimately be kept") to pick a
 * defensible default instead of guessing. Requires TYPESAFE_API_KEY; scores each fixture's
 * entries with Jev exactly once (relevance/recency don't depend on the weight — only the blend
 * does, computed locally here), then evaluates every candidate weight against that same scoring
 * pass with zero extra Jev calls.
 *
 * Usage: TYPESAFE_API_KEY=... node eval/run.mjs   (run from packages/core, after `pnpm build`)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreEntries } from '../dist/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '../../../examples/sample-transcripts')

const CANDIDATE_WEIGHTS = [0, 0.05, 0.1, 0.2, 0.3, 0.5]
const DROP_BELOW = 0.25
const SUMMARIZE_BELOW = 0.6

function combine(relevance, recency, weight) {
  return relevance * (1 - weight) + recency * weight
}

function predictedRelevant(combinedScore) {
  // "drop" is the only outcome this eval treats as "not relevant" — summarize still keeps a
  // (compressed) trace of the entry, so it counts as relevant for this accuracy measure.
  return combinedScore >= DROP_BELOW
}

const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f, ...JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) }))
  .filter((f) => f.groundTruth)

if (fixtures.length === 0) {
  console.error(`No fixtures with a "groundTruth" field found in ${fixturesDir}`)
  process.exit(1)
}

const perFixtureResults = []

for (const fixture of fixtures) {
  const scored = await scoreEntries(fixture.entries, fixture.goal, 0)
  const byEntryId = new Map(scored.map((s) => [s.entryId, s]))

  for (const weight of CANDIDATE_WEIGHTS) {
    let correct = 0
    let total = 0
    for (const [entryId, expectedRelevant] of Object.entries(fixture.groundTruth)) {
      const s = byEntryId.get(entryId)
      if (!s) continue
      const combined = combine(s.relevance, s.recency, weight)
      if (predictedRelevant(combined) === expectedRelevant) correct++
      total++
    }
    perFixtureResults.push({ fixture: fixture.name, weight, correct, total })
  }
}

console.log(`Policy: dropBelow=${DROP_BELOW}, summarizeBelow=${SUMMARIZE_BELOW} (only "drop" counts as "not relevant" here)\n`)

console.log('Per-fixture:')
for (const r of perFixtureResults) {
  const pct = ((r.correct / r.total) * 100).toFixed(0)
  console.log(`  ${r.fixture.padEnd(22)} w=${String(r.weight).padEnd(5)} ${r.correct}/${r.total} (${pct}%)`)
}

const byWeight = new Map()
for (const r of perFixtureResults) {
  const cur = byWeight.get(r.weight) ?? { correct: 0, total: 0 }
  cur.correct += r.correct
  cur.total += r.total
  byWeight.set(r.weight, cur)
}

console.log('\nAggregate accuracy by recencyWeight:')
for (const [weight, agg] of byWeight) {
  const pct = ((agg.correct / agg.total) * 100).toFixed(1)
  console.log(`  w=${String(weight).padEnd(5)} ${agg.correct}/${agg.total} (${pct}%)`)
}
