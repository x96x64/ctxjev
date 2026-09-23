#!/usr/bin/env node
/**
 * Evaluates scoring against hand-labeled fixtures (examples/sample-transcripts/*.json with a
 * `groundTruth` field: { entryId: boolean } — "does this still matter for the goal").
 *
 * Two measures, per scorer:
 * - drop accuracy by recencyWeight: does "drop vs. not drop" at the default thresholds match the
 *   labels? (Each fixture is scored once; every weight is evaluated locally from those scores.)
 * - top-K hits at the default weight: of the top K by combined score (K = 5, or fewer if the
 *   fixture has fewer relevant entries) — what the Claude Code plugin re-injects after compaction —
 *   how many are actually labeled relevant?
 *
 * The offline `local` scorer always runs, as a baseline. Jev runs too when TYPESAFE_API_KEY is set.
 *
 * Usage: node eval/run.mjs   (run from packages/core, after `pnpm build`)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_POLICY, scoreEntries } from '../dist/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '../../../examples/sample-transcripts')

const CANDIDATE_WEIGHTS = [0, 0.05, 0.1, 0.2, 0.3, 0.5]
const TOP_K = 5

const combine = (relevance, recency, weight) => relevance * (1 - weight) + recency * weight

const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f, ...JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) }))
  .filter((f) => f.groundTruth)

if (fixtures.length === 0) {
  console.error(`No fixtures with a "groundTruth" field found in ${fixturesDir}`)
  process.exit(1)
}

const scorers = process.env.TYPESAFE_API_KEY ? ['local', 'jev'] : ['local']
if (scorers.length === 1) console.log('TYPESAFE_API_KEY not set — running the offline baseline only.\n')

console.log(`Policy: dropBelow=${DEFAULT_POLICY.dropBelow}, summarizeBelow=${DEFAULT_POLICY.summarizeBelow} (only "drop" counts as "not relevant")`)
console.log(`Fixtures: ${fixtures.map((f) => `${f.name} (${f.entries.length})`).join(', ')}\n`)

for (const scorer of scorers) {
  console.log(`== scorer: ${scorer} ==`)
  const byWeight = new Map(CANDIDATE_WEIGHTS.map((w) => [w, { correct: 0, total: 0 }]))

  for (const fixture of fixtures) {
    const scored = await scoreEntries(fixture.entries, fixture.goal, 0, { scorer })
    const labeled = scored.filter((s) => s.entryId in fixture.groundTruth)

    const accuracies = []
    for (const weight of CANDIDATE_WEIGHTS) {
      const correct = labeled.filter((s) => (combine(s.relevance, s.recency, weight) >= DEFAULT_POLICY.dropBelow) === fixture.groundTruth[s.entryId]).length
      const agg = byWeight.get(weight)
      agg.correct += correct
      agg.total += labeled.length
      accuracies.push(`w=${weight}: ${correct}/${labeled.length}`)
    }

    const w = DEFAULT_POLICY.recencyWeight
    // Out of however many relevant entries could fit in the top K — a fixture with 2 relevant
    // entries can't score better than 2/5, which would read as a failure rather than a ceiling.
    const relevantCount = labeled.filter((s) => fixture.groundTruth[s.entryId]).length
    const k = Math.min(TOP_K, relevantCount)
    const topK = [...labeled].sort((a, b) => combine(b.relevance, b.recency, w) - combine(a.relevance, a.recency, w)).slice(0, k)
    const hits = topK.filter((s) => fixture.groundTruth[s.entryId]).length
    console.log(`  ${fixture.name.padEnd(24)} top-${k} hits=${hits}/${k}   ${accuracies.join('  ')}`)
  }

  console.log('  aggregate drop accuracy:')
  for (const [weight, agg] of byWeight) {
    console.log(`    w=${String(weight).padEnd(5)} ${agg.correct}/${agg.total} (${((agg.correct / agg.total) * 100).toFixed(1)}%)`)
  }
  console.log()
}
