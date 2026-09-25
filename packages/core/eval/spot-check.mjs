#!/usr/bin/env node
/**
 * The human spot check of the AI grader (decision Q4): does a person agree with the judge model's
 * "right / wrong" verdicts on answers to probe questions?
 *
 *   node eval/spot-check.mjs --from eval/results/outcome.json --sample 120 --seed 20261001 --out <items.json>
 *       Draws a stratified sample (equal shares from every condition × language, seeded) of graded
 *       answers into an items file for eval/review.mjs. The condition an answer came from is kept
 *       in the file's `key`, which the review page never receives: the reviewer judges blind.
 *   node eval/spot-check.mjs --kappa <items.json>
 *       Agreement between the reviewer (<items>.review.json, written by the review page) and the
 *       judge: Cohen's kappa with a 95% bootstrap interval (resampling items), overall and per
 *       condition. "Can't tell" answers are left out and counted.
 *
 * Offline, no API calls. Rows are read from any results file whose rows carry question, fact,
 * reply, and correct (outcome.json, plugin*.json's qa rows).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { seededRandom } from '../dist/index.js'

const { values: args } = parseArgs({
  options: { from: { type: 'string' }, sample: { type: 'string', default: '120' }, seed: { type: 'string', default: '20261001' }, out: { type: 'string' }, kappa: { type: 'string' } },
})

/** Where the review page keeps a reviewer's verdicts for an items file. */
export const reviewPathFor = (itemsPath) => itemsPath.replace(/\.json$/, '') + '.review.json'

/** A graded answer's condition: the pruning strategy and budget, or the plugin condition. */
const conditionOf = (row) => (row.strategy !== undefined ? `${row.strategy}@${row.budget}` : row.condition)

/**
 * `sample` rows of `rows`, spread evenly over condition × language strata (seeded), each turned
 * into a blind item plus its key.
 */
export function drawSample(rows, sample, seed, source) {
  const graded = rows.filter((r) => typeof r.question === 'string' && typeof r.reply === 'string' && typeof r.correct === 'boolean')
  const strata = Map.groupBy(graded, (r) => `${conditionOf(r)}|${r.language}`)
  const random = seededRandom(seed)
  const shuffled = (xs) => {
    const a = [...xs]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const keys = [...strata.keys()].sort()
  const picked = []
  const pools = new Map(keys.map((k) => [k, shuffled(strata.get(k))]))
  // Round-robin over the strata until the sample is full: as even as the strata allow.
  while (picked.length < sample && [...pools.values()].some((p) => p.length > 0)) {
    for (const k of keys) if (picked.length < sample && pools.get(k).length > 0) picked.push(pools.get(k).shift())
  }
  const order = shuffled(picked)
  const items = order.map((r, i) => ({ id: `q${String(i + 1).padStart(3, '0')}`, language: r.language, question: r.question, fact: r.fact, reply: r.reply, aiVerdict: r.correct ? 'correct' : 'incorrect' }))
  const key = Object.fromEntries(order.map((r, i) => [items[i].id, { condition: conditionOf(r), session: r.session ?? r.task, run: r.run }]))
  return { source, seed, strata: keys.length, items, key }
}

/** Cohen's kappa for two raters' binary verdicts, as [a, b] pairs. NaN when undefined. */
export function cohensKappa(pairs) {
  const n = pairs.length
  if (n === 0) return NaN
  const agree = pairs.filter(([a, b]) => a === b).length / n
  const pa = pairs.filter(([a]) => a).length / n
  const pb = pairs.filter(([, b]) => b).length / n
  const chance = pa * pb + (1 - pa) * (1 - pb)
  return chance === 1 ? (agree === 1 ? 1 : NaN) : (agree - chance) / (1 - chance)
}

function kappaReport(itemsPath) {
  const file = JSON.parse(readFileSync(itemsPath, 'utf8'))
  const review = JSON.parse(readFileSync(reviewPathFor(itemsPath), 'utf8'))
  const judged = file.items.filter((it) => review.reviews?.[it.id]?.verdict)
  const unsure = judged.filter((it) => review.reviews[it.id].verdict === 'unsure')
  const rated = judged.filter((it) => review.reviews[it.id].verdict !== 'unsure')
  const pair = (it) => [review.reviews[it.id].verdict === 'correct', it.aiVerdict === 'correct']
  const random = seededRandom(20260923)
  const interval = (items) => {
    const values = []
    for (let i = 0; i < 5000; i++) {
      const k = cohensKappa(Array.from({ length: items.length }, () => pair(items[Math.floor(random() * items.length)])))
      if (!Number.isNaN(k)) values.push(k)
    }
    values.sort((a, b) => a - b)
    return [values[Math.floor(values.length * 0.025)], values[Math.floor(values.length * 0.975)]]
  }
  const line = (label, items) => {
    const k = cohensKappa(items.map(pair))
    const [lo, hi] = items.length > 1 ? interval(items) : [NaN, NaN]
    const agree = items.filter((it) => pair(it)[0] === pair(it)[1]).length
    return `${label.padEnd(24)} n=${String(items.length).padStart(3)}  agreement ${agree}/${items.length}  kappa ${k.toFixed(2)}  95% CI [${lo.toFixed(2)}, ${hi.toFixed(2)}]`
  }
  console.log(`${judged.length} of ${file.items.length} items reviewed; ${unsure.length} marked "can't tell" and left out`)
  console.log(line('all', rated))
  for (const condition of [...new Set(rated.map((it) => file.key[it.id].condition))].sort()) {
    console.log(line(`  ${condition}`, rated.filter((it) => file.key[it.id].condition === condition)))
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (args.kappa) {
    kappaReport(args.kappa)
  } else {
    if (!args.from || !args.out) throw new Error('usage: spot-check.mjs --from <results.json> --sample N --seed S --out <items.json>, or --kappa <items.json>')
    const rows = JSON.parse(readFileSync(args.from, 'utf8')).rows
    const drawn = drawSample(rows, Number(args.sample), Number(args.seed), args.from)
    writeFileSync(args.out, `${JSON.stringify(drawn, null, 1)}\n`)
    console.log(`Wrote ${drawn.items.length} items from ${drawn.strata} condition × language strata to ${args.out}; review them with: node eval/review.mjs ${args.out}`)
  }
}
