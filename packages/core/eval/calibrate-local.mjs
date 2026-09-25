#!/usr/bin/env node
/**
 * Calibrates how `scorer: 'local'` (keyword overlap) meets `DEFAULT_POLICY`'s thresholds, on the
 * dev split only. Offline: no API calls, nothing sent anywhere.
 *
 * Keyword overlap is the share of the goal's words an entry contains, so most entries score near 0
 * and the thresholds, tuned on Jev's probabilities (drop below 0.3, summarize below 0.6), drop almost
 * everything. pruneContext() now ranks local scores within the batch first (percentile ranks, see
 * src/percentile.ts). Which way tied scores rank is the one choice left, and it's made here:
 *
 * - `raw`: the old behavior, thresholds applied to the overlap itself (for reference);
 * - `min`: a tie group takes its lowest member's rank, so entries sharing no word with the goal
 *   stay at the bottom together;
 * - `mid`: a tie group takes its members' average rank.
 *
 * Rule, fixed before this script was first run: pick the tie rule that drops the smaller share of
 * the labeled-relevant entries (mean over fixtures), and prefer `min` if the two are within one
 * point, since it's the one that never lifts a zero-overlap entry off the bottom. Every fixture
 * read here is dev: `--split` accepts nothing else, so no holdout session can inform the choice.
 *
 *   node eval/calibrate-local.mjs [--out eval/results/local-calibration-dev.json]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DEFAULT_POLICY, messagesToEntries, scoreEntries } from '../dist/index.js'
import { percentileRanks } from '../dist/percentile.js'
import { sessionSplit } from './split.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const examples = join(here, '../../../examples')
const { values: args } = parseArgs({ options: { out: { type: 'string' }, split: { type: 'string', default: 'dev' } } })
if (args.split !== 'dev') throw new Error('calibrate-local.mjs reads the dev split only')

const readJson = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }))

const fixtures = [
  ...readJson(join(examples, 'sample-transcripts'))
    .filter((f) => f.groundTruth)
    .map((f) => ({ name: f.name, set: 'short', goal: f.goal, entries: f.entries, labels: f.groundTruth })),
  ...readJson(join(examples, 'eval-sessions'))
    .filter((f) => sessionSplit(f.name) === 'dev')
    .map((f) => ({ name: f.name, set: 'sessions', goal: f.goal, entries: messagesToEntries(f.messages), labels: f.labels })),
]

const VARIANTS = ['raw', 'min', 'mid']
const combine = (relevance, recency) => relevance * (1 - DEFAULT_POLICY.recencyWeight) + recency * DEFAULT_POLICY.recencyWeight
const action = (score) => (score < DEFAULT_POLICY.dropBelow ? 'drop' : score < DEFAULT_POLICY.summarizeBelow ? 'summarize' : 'keep')
const tokens = (e) => e.sourceTokens ?? e.content.length / 4

const perFixture = {}
for (const f of fixtures) {
  const scored = await scoreEntries(f.entries, f.goal, DEFAULT_POLICY.recencyWeight, { scorer: 'local' })
  const raw = scored.map((s) => s.relevance)
  perFixture[f.name] = { set: f.set }
  for (const variant of VARIANTS) {
    const relevance = variant === 'raw' ? raw : percentileRanks(raw, variant)
    const actions = scored.map((s, i) => action(combine(relevance[i], s.recency)))
    const labeled = f.entries.map((e, i) => ({ relevant: f.labels[e.id], act: actions[i], tokens: tokens(e) })).filter((x) => x.relevant !== undefined)
    const relevant = labeled.filter((x) => x.relevant)
    const allTokens = f.entries.reduce((sum, e) => sum + tokens(e), 0)
    perFixture[f.name][variant] = {
      entriesDropped: actions.filter((a) => a === 'drop').length / actions.length,
      tokensDropped: f.entries.reduce((sum, e, i) => sum + (actions[i] === 'drop' ? tokens(e) : 0), 0) / allTokens,
      relevantDropped: relevant.filter((x) => x.act === 'drop').length / relevant.length,
      relevantKept: relevant.filter((x) => x.act === 'keep').length / relevant.length,
    }
  }
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const summary = Object.fromEntries(
  VARIANTS.map((v) => [v, Object.fromEntries(['entriesDropped', 'tokensDropped', 'relevantDropped', 'relevantKept'].map((k) => [k, mean(Object.values(perFixture).map((p) => p[v][k]))]))]),
)
const chosen = summary.mid.relevantDropped < summary.min.relevantDropped - 0.01 ? 'mid' : 'min'

const pct = (x) => `${(x * 100).toFixed(1)}%`
console.log(`dev fixtures: ${fixtures.length} (${fixtures.filter((f) => f.set === 'short').length} short, ${fixtures.filter((f) => f.set === 'sessions').length} sessions); DEFAULT_POLICY thresholds, mean over fixtures\n`)
console.log(`  ${'variant'.padEnd(8)}${'entries dropped'.padStart(17)}${'tokens dropped'.padStart(16)}${'relevant dropped'.padStart(18)}${'relevant kept'.padStart(15)}`)
for (const v of VARIANTS) {
  const s = summary[v]
  console.log(`  ${v.padEnd(8)}${pct(s.entriesDropped).padStart(17)}${pct(s.tokensDropped).padStart(16)}${pct(s.relevantDropped).padStart(18)}${pct(s.relevantKept).padStart(15)}`)
}
console.log(`\nChosen tie rule: ${chosen}`)

if (args.out) {
  let commit
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim()
  } catch {
    commit = undefined
  }
  const saved = { generatedAt: new Date().toISOString(), commit, split: 'dev', policy: DEFAULT_POLICY, fixtures: fixtures.length, rule: 'lower relevantDropped wins; min unless mid is more than 1 point lower', chosen, summary, perFixture }
  writeFileSync(args.out, `${JSON.stringify(saved, null, 1)}\n`)
  console.log(`Wrote ${args.out}`)
}
