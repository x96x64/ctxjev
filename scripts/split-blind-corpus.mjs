/**
 * Splits the blind secret-masking corpus into a dev half and a holdout half, at random, stratified
 * by kind (secret / benign). Prints counts only, never an item's text: the holdout half isn't to be
 * looked at until it's measured, once.
 *
 *   node scripts/split-blind-corpus.mjs <corpus.raw.json> <out dir>
 *
 * Items that break the corpus's own rules (a secret that isn't a substring of its text, a benign
 * item listing secrets, a duplicate id) are left out of both halves, and counted.
 * Both halves are written base64-encoded, so no provider-shaped fake credential sits in the
 * repository as a literal (a secret scanner would rightly flag one).
 */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [input, outDir] = process.argv.slice(2)
const items = JSON.parse(readFileSync(input, 'utf8'))
const seen = new Set()
const valid = []
let invalid = 0
for (const item of items) {
  const ok =
    item && typeof item.id === 'string' && !seen.has(item.id) && typeof item.text === 'string' && Array.isArray(item.secrets) &&
    (item.kind === 'secret' ? item.secrets.length > 0 && item.secrets.every((s) => typeof s === 'string' && s.length > 0 && item.text.includes(s)) : item.kind === 'benign' && item.secrets.length === 0)
  if (item && typeof item.id === 'string') seen.add(item.id)
  if (ok) valid.push(item)
  else invalid++
}

// Mulberry32 from a random seed, recorded so the split can be re-derived from the raw corpus.
const seed = randomBytes(4).readUInt32LE(0)
let state = seed
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const shuffle = (list) => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const dev = []
const holdout = []
for (const kind of ['secret', 'benign']) {
  const shuffled = shuffle(valid.filter((i) => i.kind === kind))
  const half = Math.ceil(shuffled.length / 2)
  dev.push(...shuffled.slice(0, half))
  holdout.push(...shuffled.slice(half))
}
const encode = (list) => Buffer.from(JSON.stringify(list, null, 2), 'utf8').toString('base64').replace(/.{76}/g, '$&\n') + '\n'
writeFileSync(join(outDir, 'dev.json.b64'), encode(dev))
writeFileSync(join(outDir, 'holdout.json.b64'), encode(holdout))
const count = (list, kind) => list.filter((i) => i.kind === kind).length
const summary = { seed, total: items.length, invalid, dev: { secret: count(dev, 'secret'), benign: count(dev, 'benign') }, holdout: { secret: count(holdout, 'secret'), benign: count(holdout, 'benign') } }
writeFileSync(join(outDir, 'split.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary))
