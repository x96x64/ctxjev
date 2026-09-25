#!/usr/bin/env node
/**
 * The page for checking the AI grader by hand (decision Q4): opens a local page, in Japanese, that
 * shows one graded answer at a time and records the reviewer's own verdict. Nothing leaves this
 * machine: the page is served on 127.0.0.1 only, and verdicts are saved next to the items file as
 * <items>.review.json after every click (and also kept in the browser, in case the server stops).
 *
 *   node packages/core/eval/review.mjs --demo          a few answers from eval/results/outcome.json
 *   node packages/core/eval/review.mjs <items.json>    an items file from eval/spot-check.mjs
 *
 * Options: --port N (default: any free port), --no-open (print the address instead of opening a
 * browser). Stop it with Ctrl+C; progress is already saved.
 *
 * The page never receives which pruning condition an answer came from (spot-check.mjs keeps that
 * in the file's `key`), so the check is blind to it.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { demo: { type: 'boolean' }, port: { type: 'string', default: '0' }, 'no-open': { type: 'boolean' } },
})

const DEMO_ITEMS = join(here, 'results/human-review/demo-items.json')
const itemsPath = resolve(args.demo ? DEMO_ITEMS : (positionals[0] ?? ''))
if (!args.demo && !positionals[0]) {
  console.error('使い方: node packages/core/eval/review.mjs --demo  または  node packages/core/eval/review.mjs <items.json>')
  process.exit(1)
}
if (!existsSync(itemsPath)) {
  console.error(`見つかりません: ${itemsPath}`)
  process.exit(1)
}
// The demo's verdicts go to a git-ignored folder, so trying the page leaves the repository clean.
const reviewPath = args.demo ? join(here, 'results/human-review/demo/demo-items.review.json') : itemsPath.replace(/\.json$/, '') + '.review.json'
mkdirSync(dirname(reviewPath), { recursive: true })

const file = JSON.parse(readFileSync(itemsPath, 'utf8'))
// Blind: only what the reviewer needs, never the key.
const items = file.items.map(({ id, language, question, fact, reply, aiVerdict }) => ({ id, language, question, fact, reply, aiVerdict }))
const readReview = () => (existsSync(reviewPath) ? JSON.parse(readFileSync(reviewPath, 'utf8')) : { items: itemsPath, reviews: {} })
const page = readFileSync(join(here, 'review.html'), 'utf8')

// Only this page may talk to the server: every request carries a random token a website the
// reviewer happens to visit can't know, sent as a header that a cross-site request can't set.
const token = randomBytes(16).toString('hex')
const VERDICTS = new Set(['correct', 'incorrect', 'unsure'])

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(body)
  }
  if (req.method === 'GET' && url.pathname === '/') return send(200, 'text/html; charset=utf-8', page)
  if (req.headers['x-review-token'] !== token) return send(403, 'text/plain; charset=utf-8', 'forbidden')
  if (req.method === 'GET' && url.pathname === '/api/items') return send(200, 'application/json', JSON.stringify({ items, review: readReview(), demo: Boolean(args.demo) }))
  if (req.method === 'POST' && url.pathname === '/api/review') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 5_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body)
        const reviews = {}
        for (const item of items) {
          const r = incoming.reviews?.[item.id]
          if (r && (r.verdict === undefined || VERDICTS.has(r.verdict))) reviews[item.id] = { verdict: r.verdict, note: String(r.note ?? '').slice(0, 5000), at: String(r.at ?? '') }
        }
        const saved = { items: itemsPath, reviewer: String(incoming.reviewer ?? '').slice(0, 200), savedAt: new Date().toISOString(), reviews }
        const tmp = `${reviewPath}.tmp`
        writeFileSync(tmp, `${JSON.stringify(saved, null, 1)}\n`)
        renameSync(tmp, reviewPath)
        send(200, 'application/json', JSON.stringify({ ok: true, savedAt: saved.savedAt }))
      } catch (err) {
        send(400, 'text/plain; charset=utf-8', String(err.message))
      }
    })
    return
  }
  send(404, 'text/plain; charset=utf-8', 'not found')
})

server.listen(Number(args.port), '127.0.0.1', () => {
  const address = `http://127.0.0.1:${server.address().port}/#${token}`
  console.log(`レビューページ: ${address}`)
  console.log(`判定の保存先: ${reviewPath}`)
  console.log('終わったら、この画面で Ctrl+C を押して止めてください（判定はクリックのたびに保存済みです）。')
  if (!args['no-open']) {
    const [cmd, cmdArgs] = process.platform === 'darwin' ? ['open', [address]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', address]] : ['xdg-open', [address]]
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => console.log('ブラウザを自動で開けませんでした。上のアドレスをブラウザに貼り付けてください。')).unref()
  }
})
