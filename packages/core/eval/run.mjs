#!/usr/bin/env node
/**
 * Evaluates scoring against hand-labeled fixtures, in two sets:
 *
 * - dev (examples/sample-transcripts/*.json with `groundTruth`): short one-line entries. Used to
 *   tune `DEFAULT_POLICY`, so its numbers are optimistic by construction.
 * - held-out (examples/eval-sessions/*.json): raw Anthropic Messages conversations with realistic
 *   tool output (multi-line logs, diffs, stack traces, thousands of tokens), English and Japanese.
 *   Never used for tuning — only for checking that what was tuned on dev holds up.
 *
 * Labeling policy (both sets): an entry is relevant if someone picking the task up from here would
 * need it — the symptom, evidence for the cause, a constraint the user stated, the current state
 * of the fix. Superseded results (an error a later entry fixed, an approach that was reverted) and
 * noise (installs, lint runs, unrelated files, distractors that merely share the goal's words) are
 * not. Held-out fixtures also carry `probes`: facts the task will need later, each with the entries
 * that state it. A probe counts as retained if any of its entries survives.
 *
 * Measures, per scorer:
 * - drop accuracy by recencyWeight: does "drop vs. not drop" at the default thresholds match the
 *   labels? (Each fixture is scored once per run; every weight is evaluated from those scores.)
 * - top-K hits at the default weight: of the top K by combined score (K = 5, or fewer if the
 *   fixture has fewer relevant entries) — what the Claude Code plugin re-injects after compaction —
 *   how many are actually labeled relevant?
 * - held-out only, budget retention: pruneMessages() with `targetTokens` at 25% / 50% of the
 *   conversation, ranking by each strategy's scores. How many probes survive, and what share of the
 *   relevant tokens? Baselines: `recency` (keep the newest, which is what plain truncation does),
 *   `random` (seeded, averaged), and `labels` (relevant entries first, by the labels themselves).
 *   `labels` isn't a ceiling: it ignores size, so a large relevant log can cost several small
 *   entries that each state a probe's fact.
 *
 * The offline `local` scorer always runs. Jev runs too when TYPESAFE_API_KEY is set, `--runs N`
 * times (default 1), since its answers vary slightly between calls; results are averaged.
 *
 * With --gate (publish.yml runs this with --runs 3), exits 1 if:
 * - Jev's mean drop accuracy at the default weight falls below the offline baseline's,
 * - Jev misses more than one of any fixture's top K on average, or
 * - on held-out at a 50% budget, Jev's mean probe retention falls below recency's or local's.
 *
 * Usage: node eval/run.mjs [--gate] [--runs N] [--json]   (from packages/core, after `pnpm build`)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DEFAULT_POLICY, messagesToEntries, pruneMessages, scoreEntries } from '../dist/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const examplesDir = join(__dirname, '../../../examples')

const CANDIDATE_WEIGHTS = [0, 0.05, 0.1, 0.2, 0.3, 0.5]
const TOP_K = 5
const BUDGETS = [0.25, 0.5]
const RANDOM_SEEDS = 20

const { values: args } = parseArgs({ options: { gate: { type: 'boolean' }, json: { type: 'boolean' }, runs: { type: 'string', default: '1' } } })
const runs = Number(args.runs)
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a whole number of at least 1, got ${args.runs}`)
const log = args.json ? () => {} : console.log

const combine = (relevance, recency, weight) => relevance * (1 - weight) + recency * weight
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const pct = (x) => `${(x * 100).toFixed(1)}%`.padStart(6)

function readJson(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }))
}

const fixtures = [
  ...readJson(join(examplesDir, 'sample-transcripts'))
    .filter((f) => f.groundTruth)
    .map((f) => ({ ...f, set: 'dev', labels: f.groundTruth })),
  ...readJson(join(examplesDir, 'eval-sessions')).map((f) => ({ ...f, set: 'held-out', entries: messagesToEntries(f.messages) })),
]
if (fixtures.length === 0) {
  console.error('No labeled fixtures found under examples/')
  process.exit(1)
}

const scorers = process.env.TYPESAFE_API_KEY ? ['local', 'jev'] : ['local']
if (scorers.length === 1) log('TYPESAFE_API_KEY not set — running the offline baseline only.\n')
log(`Policy: dropBelow=${DEFAULT_POLICY.dropBelow}, summarizeBelow=${DEFAULT_POLICY.summarizeBelow}, recencyWeight=${DEFAULT_POLICY.recencyWeight} (only "drop" counts as "not relevant")`)
for (const set of ['dev', 'held-out']) {
  const fs = fixtures.filter((f) => f.set === set)
  log(`${set.padEnd(8)}: ${fs.map((f) => `${f.name} (${f.entries.length})`).join(', ')}`)
}
log()

/** Relevance per entry id, from one scoring pass. */
async function relevanceById(fixture, scorer) {
  const scored = await scoreEntries(fixture.entries, fixture.goal, 0, { scorer })
  return new Map(scored.map((s) => [s.entryId, s.relevance]))
}

function classification(fixture, relevance) {
  const recency = new Map(fixture.entries.map((e, i, all) => [e.id, all.length === 1 ? 1 : i / (all.length - 1)]))
  const labeled = fixture.entries.filter((e) => e.id in fixture.labels)
  const correctByWeight = CANDIDATE_WEIGHTS.map(
    (w) => labeled.filter((e) => (combine(relevance.get(e.id), recency.get(e.id), w) >= DEFAULT_POLICY.dropBelow) === fixture.labels[e.id]).length,
  )
  const w = DEFAULT_POLICY.recencyWeight
  const k = Math.min(TOP_K, labeled.filter((e) => fixture.labels[e.id]).length)
  const topK = [...labeled].sort((a, b) => combine(relevance.get(b.id), recency.get(b.id), w) - combine(relevance.get(a.id), recency.get(a.id), w)).slice(0, k)
  return { total: labeled.length, correctByWeight, k, topKMisses: k - topK.filter((e) => fixture.labels[e.id]).length }
}

// Ranks by `score(entryId)` blended with recency at `recencyWeight`, and drops lowest-first until the budget fits.
async function retention(fixture, score, recencyWeight) {
  const total = fixture.entries.reduce((sum, e) => sum + e.sourceTokens, 0)
  const relevantTokens = fixture.entries.filter((e) => fixture.labels[e.id]).reduce((sum, e) => sum + e.sourceTokens, 0)
  const out = {}
  for (const budget of BUDGETS) {
    const { removed } = await pruneMessages(fixture.messages, fixture.goal, {
      scorer: async (_goal, entries) => entries.map((e) => score(e.id)),
      policy: { dropBelow: 0, summarizeBelow: 0, recencyWeight },
      targetTokens: Math.floor(total * budget),
      // Compares rankings alone; the shipped keepUserText would keep user-stated facts for every strategy.
      keepUserText: false,
      marker: false,
    })
    const gone = new Set(removed)
    const kept = fixture.entries.filter((e) => !gone.has(e.id))
    out[budget] = {
      probes: fixture.probes.filter((p) => p.entryIds.some((id) => !gone.has(id))).length / fixture.probes.length,
      relevantTokens: kept.filter((e) => fixture.labels[e.id]).reduce((sum, e) => sum + e.sourceTokens, 0) / relevantTokens,
    }
  }
  return out
}

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const averageRetention = (results) =>
  Object.fromEntries(BUDGETS.map((b) => [b, { probes: mean(results.map((r) => r[b].probes)), relevantTokens: mean(results.map((r) => r[b].relevantTokens)) }]))

// --- scoring ---------------------------------------------------------------------------------

const results = {} // scorer → fixture name → [{ classification, retention? }] (one per run)
for (const scorer of scorers) {
  results[scorer] = {}
  for (const fixture of fixtures) {
    results[scorer][fixture.name] = []
    for (let run = 0; run < (scorer === 'jev' ? runs : 1); run++) {
      const relevance = await relevanceById(fixture, scorer)
      results[scorer][fixture.name].push({
        classification: classification(fixture, relevance),
        ...(fixture.set === 'held-out' && { retention: await retention(fixture, (id) => relevance.get(id), DEFAULT_POLICY.recencyWeight) }),
      })
    }
  }
}

const baselines = {}
for (const fixture of fixtures.filter((f) => f.set === 'held-out')) {
  const order = new Map(fixture.entries.map((e, i) => [e.id, i / (fixture.entries.length - 1)]))
  const randoms = []
  for (let seed = 1; seed <= RANDOM_SEEDS; seed++) {
    const random = seeded(seed)
    const scores = new Map(fixture.entries.map((e) => [e.id, random()]))
    randoms.push(await retention(fixture, (id) => scores.get(id), 0))
  }
  baselines[fixture.name] = {
    recency: await retention(fixture, (id) => order.get(id), 0),
    random: averageRetention(randoms),
    labels: await retention(fixture, (id) => (fixture.labels[id] ? 1 : 0), 0),
  }
}

// --- report ----------------------------------------------------------------------------------

const summary = { runs, sets: {} }
for (const set of ['dev', 'held-out', 'all']) {
  const inSet = fixtures.filter((f) => set === 'all' || f.set === set)
  summary.sets[set] = {}
  for (const scorer of scorers) {
    const perRun = Array.from({ length: scorer === 'jev' ? runs : 1 }, (_, run) => {
      const cs = inSet.map((f) => results[scorer][f.name][run].classification)
      const total = cs.reduce((sum, c) => sum + c.total, 0)
      return CANDIDATE_WEIGHTS.map((_, i) => cs.reduce((sum, c) => sum + c.correctByWeight[i], 0) / total)
    })
    summary.sets[set][scorer] = {
      labels: inSet.reduce((sum, f) => sum + Object.keys(f.labels).length, 0),
      accuracyByWeight: Object.fromEntries(CANDIDATE_WEIGHTS.map((w, i) => [w, mean(perRun.map((r) => r[i]))])),
      minAccuracyAtDefault: Math.min(...perRun.map((r) => r[CANDIDATE_WEIGHTS.indexOf(DEFAULT_POLICY.recencyWeight)])),
      topKMisses: Object.fromEntries(inSet.map((f) => [f.name, mean(results[scorer][f.name].map((r) => r.classification.topKMisses))])),
    }
  }
}

const retentionSummary = {}
const heldOut = fixtures.filter((f) => f.set === 'held-out')
for (const strategy of [...scorers, 'recency', 'random', 'labels']) {
  const perFixture = heldOut.map((f) => (scorers.includes(strategy) ? averageRetention(results[strategy][f.name].map((r) => r.retention)) : baselines[f.name][strategy]))
  retentionSummary[strategy] = {
    ...averageRetention(perFixture),
    byLanguage: Object.fromEntries(['en', 'ja'].map((lang) => [lang, averageRetention(perFixture.filter((_, i) => heldOut[i].language === lang))])),
    byKind: Object.fromEntries(['written', 'recorded'].map((kind) => [kind, averageRetention(perFixture.filter((_, i) => Boolean(heldOut[i].recorded) === (kind === 'recorded')))])),
  }
}
summary.retention = retentionSummary

for (const set of ['dev', 'held-out', 'all']) {
  log(`== ${set} ==`)
  for (const scorer of scorers) {
    const s = summary.sets[set][scorer]
    const acc = CANDIDATE_WEIGHTS.map((w) => `w=${w}: ${pct(s.accuracyByWeight[w])}`).join('  ')
    log(`  ${scorer.padEnd(6)} drop accuracy over ${s.labels} labels${scorer === 'jev' && runs > 1 ? ` (mean of ${runs} runs, worst ${pct(s.minAccuracyAtDefault).trim()} at default)` : ''}`)
    log(`         ${acc}`)
    if (set !== 'all') {
      const misses = Object.entries(s.topKMisses).map(([name, m]) => `${name.replace('.json', '')}=${Number.isInteger(m) ? m : m.toFixed(1)}`)
      log(`         top-K misses: ${misses.join('  ')}`)
    }
  }
  log()
}

log(`== held-out: budget retention (${heldOut.length} sessions; probe retention / relevant-token recall) ==`)
log(`  ${'strategy'.padEnd(9)}${BUDGETS.map((b) => `budget ${b * 100}%`.padEnd(22)).join('')}by language and kind (probes at 25% / 50%)`)
for (const [strategy, r] of Object.entries(retentionSummary)) {
  const cols = BUDGETS.map((b) => `${pct(r[b].probes)} / ${pct(r[b].relevantTokens)}`.padEnd(22)).join('')
  const langs = [...Object.entries(r.byLanguage), ...Object.entries(r.byKind)].map(([key, lr]) => `${key} ${pct(lr[0.25].probes).trim()}/${pct(lr[0.5].probes).trim()}`).join('  ')
  log(`  ${strategy.padEnd(9)}${cols}${langs}`)
}
log()

if (args.json) console.log(JSON.stringify(summary, null, 2))

if (args.gate) {
  if (!summary.sets.all.jev) {
    log('--gate: TYPESAFE_API_KEY not set, so there is no Jev result to check — skipping.')
    process.exit(0)
  }
  const failures = []
  const w = DEFAULT_POLICY.recencyWeight
  const jevAccuracy = summary.sets.all.jev.accuracyByWeight[w]
  const localAccuracy = summary.sets.all.local.accuracyByWeight[w]
  if (jevAccuracy < localAccuracy) failures.push(`Jev's mean drop accuracy (${pct(jevAccuracy).trim()}) is below the offline baseline's (${pct(localAccuracy).trim()})`)
  for (const [name, misses] of Object.entries(summary.sets.all.jev.topKMisses)) {
    if (misses > 1) failures.push(`${name}: Jev missed ${misses.toFixed(1)} of its top-K on average (at most 1 allowed)`)
  }
  const jevRetention = retentionSummary.jev[0.5].probes
  for (const baseline of ['recency', 'local']) {
    const other = retentionSummary[baseline][0.5].probes
    if (jevRetention < other) failures.push(`held-out at a 50% budget: Jev keeps ${pct(jevRetention).trim()} of probes, below ${baseline}'s ${pct(other).trim()}`)
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`GATE FAILED: ${f}`)
    process.exit(1)
  }
  log('--gate: passed.')
}
