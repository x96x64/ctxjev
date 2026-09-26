#!/usr/bin/env node
/**
 * Feeds ctxjev's public entry points systematic edge inputs and checks four things about every
 * outcome: no raw TypeError/RangeError (a bad input gets a plain Error naming it), no NaN in the
 * output, no call slower than its limit, and a result whose structure is still valid.
 *
 *   node scripts/boundary-bruteforce.mjs [<repo root>] [--json <file>]
 *
 * Entry points: pruneContext, scoreEntries, summarizeSavings, pruneEntries, messagesToEntries,
 * pruneMessages, estimateTokens, redactSecrets (in-process, from packages/core/dist); `ctxjev
 * analyze` and `ctxjev prune` (packages/cli/dist, as a subprocess); and the MCP server's two tools
 * (packages/mcp-server/dist over stdio, with a fake key and a local stand-in for Jev). Offline:
 * nothing is sent anywhere but that local stand-in. Build first (`pnpm build`). Exits 1 on any
 * violation. The third audit's round asked for it: "a simple brute force over boundary inputs
 * (size, type, extreme values)" would have found its findings 1c and 4c before it did.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined
const root = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--json') ?? '.')
const core = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href)
const cliPath = join(root, 'packages/cli/dist/index.js')
const mcpPath = join(root, 'packages/mcp-server/dist/index.js')
const mcpRequire = createRequire(join(root, 'packages/mcp-server/package.json'))
const { Client } = await import(pathToFileURL(mcpRequire.resolve('@modelcontextprotocol/sdk/client/index.js')).href)
const { StdioClientTransport } = await import(pathToFileURL(mcpRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href)

// ---------------------------------------------------------------------------------------------
// Edge values

const HUGE = 200_000
const UNICODE = {
  'lone surrogate': 'a\uD800b\uDC00c',
  'RTL override': 'safe ‮eslaf',
  'zero-width': 'a​‌‍﻿b',
  'ZWJ emoji': '👨‍👩‍👧‍👦🏳️‍🌈',
  'combining marks': `e${'́'.repeat(500)}`,
  'CJK no punctuation': '請求書日付検証処理'.repeat(500),
  NUL: 'a\u0000b',
  'CRLF and tabs': 'a\r\n\tb\r\n',
}
const STRINGS = {
  empty: '',
  one: 'x',
  ...Object.fromEntries(Object.entries(UNICODE).map(([k, v]) => [`unicode: ${k}`, v])),
  [`x × ${HUGE}`]: 'x'.repeat(HUGE),
  [`█ × ${HUGE / 2}`]: '█'.repeat(HUGE / 2),
  [`a.a.a × ${HUGE}`]: 'a.'.repeat(HUGE / 2),
  [`"k": "v" × ${HUGE}`]: '"k": "'.repeat(HUGE / 6),
  // One tokenizer pre-token of mixed kinds, and a spelled special token (encode() refuses one).
  [`/ and line breaks × ${HUGE}`]: '/\n'.repeat(HUGE / 2),
  [`!! and an accent × ${HUGE}`]: '!!\u0301'.repeat(HUGE / 3),
  'a special token': 'the model stops at <|endoftext|> here',
  'a secret after a label': 'Error: DB_PASSWORD=hunter22',
}
const NUMBERS = { 0: 0, '-1': -1, '1.5': 1.5, NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, '-Infinity': Number.NEGATIVE_INFINITY, '1e308': 1e308, '-1e308': -1e308, 'MAX_SAFE+1': Number.MAX_SAFE_INTEGER + 1 }
const WRONG = { missing: undefined, null: null, true: true, 'number 7': 7, "string '100'": '100', array: [], object: {} }
const ALL = { ...WRONG, ...NUMBERS, ...Object.fromEntries(Object.entries(STRINGS).map(([k, v]) => [`string: ${k}`, v])) }

const entry = (i, over = {}) => ({ id: `e${i}`, role: ['user', 'tool', 'assistant'][i % 3], toolName: i % 3 === 1 ? 'Bash' : undefined, content: `entry ${i} about the checkout retry`, timestamp: i, ...over })
const withField = (base, field, value) => {
  const copy = { ...base }
  if (value === undefined) delete copy[field]
  else copy[field] = value
  return copy
}

// ---------------------------------------------------------------------------------------------
// Checks

const violations = []
const counts = {}
let current = ''

function findNaN(value, path = '$', seen = new Set()) {
  if (typeof value === 'number') return Number.isNaN(value) ? path : undefined
  if (typeof value === 'string') return undefined
  if (typeof value !== 'object' || value === null || seen.has(value)) return undefined
  seen.add(value)
  for (const [k, v] of Object.entries(value)) {
    const found = findNaN(v, `${path}.${k}`, seen)
    if (found) return found
  }
  return undefined
}

const RAW = /TypeError|RangeError|ReferenceError|SyntaxError: (?!Unexpected|Expected|Bad control)|Cannot read propert|is not a function|is not iterable|Maximum call stack|undefined \(reading/

function record(point, name, problem) {
  violations.push({ point, case: name, problem })
}

// An older build (to measure what this finds there) may not have every export; its cases are skipped.
const missing = new Set()
async function check(point, name, run, { limitMs = 5000, validate } = {}) {
  const fn = point.split(' ')[0]
  if (!fn.startsWith('cli') && !fn.startsWith('mcp') && typeof core[fn] !== 'function') {
    missing.add(fn)
    return
  }
  counts[point] = (counts[point] ?? 0) + 1
  current = `${point} :: ${name}`
  const start = performance.now()
  let result
  let error
  try {
    result = await run()
  } catch (err) {
    error = err
  }
  const ms = performance.now() - start
  if (ms > limitMs) record(point, name, `took ${Math.round(ms)} ms (limit ${limitMs})`)
  if (error !== undefined) {
    if (!(error instanceof Error)) record(point, name, `threw a non-Error: ${String(error)}`)
    else if (error.constructor !== Error || RAW.test(error.message)) record(point, name, `raw ${error.constructor.name}: ${error.message.slice(0, 200)}`)
    else if (!error.message) record(point, name, 'threw an Error with no message')
    return
  }
  const nan = findNaN(result)
  if (nan) record(point, name, `NaN in the output at ${nan}`)
  if (validate) {
    const problem = validate(result)
    if (problem) record(point, name, `invalid result: ${problem}`)
  }
}

const finite01 = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1
function validDecisions(decisions, entries) {
  if (!Array.isArray(decisions)) return 'decisions not an array'
  if (decisions.length !== entries.length) return `${decisions.length} decisions for ${entries.length} entries`
  for (const [i, d] of decisions.entries()) {
    if (d.entryId !== entries[i].id) return `decision ${i} is for ${d.entryId}, not ${entries[i].id}`
    if (!['keep', 'drop', 'summarize'].includes(d.action ?? 'keep')) return `bad action ${d.action}`
    for (const k of ['relevance', 'recency', 'combinedScore']) if (!finite01(d[k])) return `${k} ${d[k]} not in 0-1`
  }
  return undefined
}

function validPruned(result, messages) {
  if (!Array.isArray(result.messages)) return 'messages not an array'
  if (messages.length > 0 && result.messages[0] !== messages[0]) return 'first message changed'
  if (!(Number.isFinite(result.savedTokens) && result.savedTokens >= 0)) return `savedTokens ${result.savedTokens}`
  if (typeof result.overBudget !== 'boolean') return 'overBudget not a boolean'
  // Only what pruning broke counts: a problem the input already had (an empty message, a
  // tool_result for a call that isn't there) is passed through, not introduced.
  const inputUses = new Set(messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b?.type === 'tool_use').map((b) => b.id) : [])))
  const uses = new Set()
  const results = new Set()
  for (const m of result.messages) {
    if (typeof m.content !== 'string' && (!Array.isArray(m.content) || m.content.length === 0) && !messages.includes(m)) return 'an empty or malformed message'
    if (!Array.isArray(m.content)) continue
    for (const b of m.content) {
      if (b.type === 'tool_use') uses.add(b.id)
      if (b.type === 'tool_result') {
        if (!uses.has(b.tool_use_id) && inputUses.has(b.tool_use_id)) return `tool_result ${b.tool_use_id} without its tool_use`
        results.add(b.tool_use_id)
      }
    }
  }
  const last = result.messages.at(-1)
  const pending = new Set(Array.isArray(last?.content) ? last.content.filter((b) => b.type === 'tool_use').map((b) => b.id) : [])
  for (const id of uses) if (!results.has(id) && !pending.has(id) && [...messages].some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result' && b.tool_use_id === id))) return `tool_use ${id} lost its tool_result`
  return validDecisions(result.decisions, core.messagesToEntries(messages))
}

// ---------------------------------------------------------------------------------------------
// core, in-process

const scorers = ['recency', 'local', async (_goal, es) => es.map((_, i) => (i % 5) / 4)]
const scorerName = (s) => (typeof s === 'function' ? 'custom' : s)

// Sizes, with every scorer.
for (const n of [0, 1, 2, 1000, 10_000]) {
  const entries = Array.from({ length: n }, (_, i) => entry(i))
  for (const scorer of scorers) {
    await check('pruneContext', `${n} entries, ${scorerName(scorer)}`, () => core.pruneContext(entries, 'fix the checkout retry', undefined, { scorer }), { validate: (d) => validDecisions(d, entries), limitMs: 10_000 })
  }
  await check('summarizeSavings', `${n} entries`, async () => core.summarizeSavings(entries, await core.pruneContext(entries, 'g')))
  await check('pruneEntries', `${n} entries`, async () => core.pruneEntries(entries, await core.pruneContext(entries, 'g')))
}

// Every field of an entry, every edge value, with every scorer.
for (const field of ['id', 'role', 'toolName', 'content', 'timestamp', 'sourceTokens']) {
  for (const [label, value] of Object.entries(ALL)) {
    const entries = [entry(0), withField(entry(1), field, value), entry(2)]
    for (const scorer of scorers) {
      await check('pruneContext', `entries[1].${field} = ${label}, ${scorerName(scorer)}`, () => core.pruneContext(entries, 'fix the checkout retry', undefined, { scorer }), { validate: (d) => validDecisions(d, entries) })
    }
    await check('scoreEntries', `entries[1].${field} = ${label}`, () => core.scoreEntries(entries, 'g'))
    await check('summarizeSavings', `entries[1].${field} = ${label}`, () => core.summarizeSavings(entries, entries.map((e) => ({ entryId: e.id, relevance: 1, recency: 1, combinedScore: 1, action: 'keep' }))))
  }
}

// The goal, the entries themselves, the policy, and the options.
for (const [label, goal] of Object.entries(ALL)) await check('pruneContext', `goal = ${label}`, () => core.pruneContext([entry(0), entry(1)], goal, undefined, { scorer: 'local' }), { validate: (d) => validDecisions(d, [entry(0), entry(1)]) })
for (const [label, entries] of Object.entries({ ...WRONG, 'array of null': [null], 'array of strings': ['a'], 'duplicate ids': [entry(0), entry(0)] })) {
  await check('pruneContext', `entries = ${label}`, () => core.pruneContext(entries, 'g'))
}
for (const key of ['dropBelow', 'summarizeBelow', 'recencyWeight']) {
  for (const [label, value] of Object.entries({ ...WRONG, ...NUMBERS })) {
    const policy = withField({ dropBelow: 0.3, summarizeBelow: 0.6, recencyWeight: 0.1 }, key, value)
    await check('pruneContext', `policy.${key} = ${label}`, () => core.pruneContext([entry(0), entry(1)], 'g', policy), { validate: (d) => validDecisions(d, [entry(0), entry(1)]) })
  }
}
for (const [label, value] of Object.entries(ALL)) await check('pruneContext', `options.scorer = ${label}`, () => core.pruneContext([entry(0)], 'g', undefined, { scorer: value }))
for (const [label, text] of Object.entries(STRINGS)) {
  await check('estimateTokens', label, () => core.estimateTokens(text), { validate: (n) => (Number.isInteger(n) && n >= 0 ? undefined : `returned ${n}`) })
  await check('redactSecrets', label, () => core.redactSecrets(text), { validate: (s) => (typeof s === 'string' ? undefined : 'not a string') })
}

// Anthropic Messages: sizes, every block shape, every option.
const convo = (n) => {
  const messages = [{ role: 'user', content: 'Fix the checkout retry double charge' }]
  for (let i = 0; i < n; i++) {
    messages.push({ role: 'assistant', content: [{ type: 'text', text: `step ${i}` }, { type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: `cmd ${i}` } }] })
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: `output ${i} `.repeat(20) }] })
  }
  messages.push({ role: 'assistant', content: 'done' })
  return messages
}
for (const n of [0, 1, 5, 2000]) {
  const messages = convo(n)
  for (const protectLastTurn of [true, false]) {
    await check('pruneMessages', `${n} tool calls, protectLastTurn ${protectLastTurn}`, () => core.pruneMessages(messages, 'g', { protectLastTurn, targetTokens: 50 }), { validate: (r) => validPruned(r, messages), limitMs: 20_000 })
  }
}
await check('pruneMessages', 'no messages', () => core.pruneMessages([], 'g'), { validate: (r) => validPruned(r, []) })
const blockShapes = {
  'text, no text': { type: 'text' },
  'text, text 5': { type: 'text', text: 5 },
  'text, huge': { type: 'text', text: 'x'.repeat(HUGE) },
  'text, unicode': { type: 'text', text: Object.values(UNICODE).join(' ') },
  null: null,
  'no type': { text: 'x' },
  'type 5': { type: 5 },
  image: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
  thinking: { type: 'thinking', thinking: 'hmm', signature: 's' },
  'tool_use, no id': { type: 'tool_use', name: 'Bash', input: {} },
  'tool_use, no name': { type: 'tool_use', id: 'z', input: {} },
  'tool_use, input null': { type: 'tool_use', id: 'z', name: 'Bash', input: null },
  'tool_result, no tool_use_id': { type: 'tool_result', content: 'x' },
  'tool_result, content 5': { type: 'tool_result', tool_use_id: 't0', content: 5 },
  'tool_result, content [null]': { type: 'tool_result', tool_use_id: 't0', content: [null] },
  'tool_result, content [{type: text}]': { type: 'tool_result', tool_use_id: 't0', content: [{ type: 'text' }] },
  'tool_result for an unknown call': { type: 'tool_result', tool_use_id: 'nope', content: 'x' },
}
for (const [label, block] of Object.entries(blockShapes)) {
  const messages = convo(2)
  messages.splice(2, 0, { role: 'user', content: [block] }, { role: 'assistant', content: 'ok' })
  await check('messagesToEntries', `block: ${label}`, () => core.messagesToEntries(messages))
  await check('pruneMessages', `block: ${label}`, () => core.pruneMessages(messages, 'g', { protectLastTurn: false }), { validate: (r) => validPruned(r, messages) })
}
for (const [label, message] of Object.entries({ null: null, 'role system': { role: 'system', content: 'x' }, 'no role': { content: 'x' }, 'content 5': { role: 'user', content: 5 }, 'content []': { role: 'user', content: [] }, 'content null': { role: 'user', content: null } })) {
  const messages = [...convo(1), message]
  await check('pruneMessages', `message: ${label}`, () => core.pruneMessages(messages, 'g'), { validate: (r) => validPruned(r, messages) })
}
for (const option of ['protectLast', 'targetTokens', 'minSavedTokens', 'protectLastTurn', 'keepUserText', 'marker', 'summarize']) {
  for (const [label, value] of Object.entries({ ...WRONG, ...NUMBERS, excerpt: 'excerpt' })) {
    const messages = convo(5)
    await check('pruneMessages', `options.${option} = ${label}`, () => core.pruneMessages(messages, 'g', { [option]: value, protectLastTurn: option === 'protectLastTurn' ? value : false }), { validate: (r) => validPruned(r, messages) })
  }
}
for (const [label, value] of Object.entries({ ...WRONG, ...NUMBERS })) {
  await check('pruneEntries', `options.protectLast = ${label}`, async () => core.pruneEntries([entry(0), entry(1)], await core.pruneContext([entry(0), entry(1)], 'g'), { protectLast: value }))
}

// ---------------------------------------------------------------------------------------------
// The CLI, as a subprocess

const dir = mkdtempSync(join(tmpdir(), 'ctxjev-bruteforce-'))
const cleanEnv = { PATH: process.env.PATH, HOME: join(dir, 'home'), NO_COLOR: '1', TYPESAFE_BASE_URL: 'http://127.0.0.1:9' }
function runCli(argv) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cliPath, ...argv], { env: cleanEnv })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolveRun({ code, signal, stdout, stderr })
    })
  })
}
let fileCount = 0
async function checkCli(name, body, extra = []) {
  const file = join(dir, `t${fileCount++}.json`)
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body))
  for (const command of ['analyze', 'prune']) {
    await check(`cli ${command}`, name, async () => {
      const r = await runCli([command, file, ...extra])
      if (r.signal) throw new TypeError(`killed by ${r.signal}`)
      const all = r.stdout + r.stderr
      if (RAW.test(all)) throw new TypeError(all.match(RAW)[0] + ': ' + all.slice(0, 200))
      // An error quoting the value it was given (`got "NaN"`) isn't a NaN the CLI produced.
      if (/NaN/.test(all.replace(/got "[^"]*"/g, ''))) return { nan: Number.NaN }
      if (r.code !== 0 && r.code !== 1) throw new TypeError(`exit code ${r.code}`)
      if (r.code === 0 && command === 'prune') JSON.parse(r.stdout)
      return { code: r.code }
    }, { limitMs: 30_000 })
  }
}
const cliEntries = (over) => ({ goal: 'fix the checkout retry', entries: [entry(0), withField(entry(1), ...over), entry(2)] })
for (const field of ['id', 'role', 'toolName', 'content', 'timestamp', 'sourceTokens']) {
  for (const [label, value] of Object.entries({ ...WRONG, ...Object.fromEntries(Object.entries(NUMBERS).filter(([k]) => !['NaN', 'Infinity', '-Infinity'].includes(k))) })) {
    await checkCli(`entries[1].${field} = ${label}`, cliEntries([field, value]))
  }
}
for (const [label, value] of Object.entries(STRINGS)) await checkCli(`content = ${label}`, cliEntries(['content', value]))
await checkCli('5,000,000-character entry', { goal: 'g', entries: [entry(0, { content: '█'.repeat(5_000_000) }), entry(1)] })
await checkCli('no entries', { goal: 'g', entries: [] })
await checkCli('10,000 entries', { goal: 'g', entries: Array.from({ length: 10_000 }, (_, i) => entry(i)) })
for (const [label, block] of Object.entries(blockShapes)) {
  const messages = convo(2)
  messages.splice(2, 0, { role: 'user', content: [block] }, { role: 'assistant', content: 'ok' })
  await checkCli(`messages block: ${label}`, messages)
}
for (const [label, body] of Object.entries({ 'not JSON': '{"goal": ', 'a number': '5', 'null': 'null', 'an empty object': '{}', 'goal only': '{"goal": "x"}', 'empty file': '' })) await checkCli(`file: ${label}`, body)
for (const [flag, value] of [['--target-tokens', 'NaN'], ['--target-tokens', '-1'], ['--target-tokens', '1e308'], ['--protect-last', 'Infinity'], ['--drop-below', 'NaN'], ['--drop-below', '2'], ['--summarize-below', '-1'], ['--min-saved-tokens', '1.5']]) {
  await checkCli(`flag ${flag} ${value}`, convo(3), [flag, value])
}

// ---------------------------------------------------------------------------------------------
// The MCP server over stdio, with a fake key and a local stand-in for Jev

const jev = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const ids = Object.keys(JSON.parse(body).questions ?? {})
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ answers: Object.fromEntries(ids.map((id, i) => [id, { noul: (i % 10) / 9 }])), usage: { input_tokens: 10 * ids.length, output_tokens: ids.length } }))
  })
})
await new Promise((r) => jev.listen(0, '127.0.0.1', r))
const client = new Client({ name: 'ctxjev-bruteforce', version: '0.0.0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [mcpPath], env: { ...cleanEnv, TYPESAFE_API_KEY: 'not-a-real-key', TYPESAFE_BASE_URL: `http://127.0.0.1:${jev.address().port}` }, stderr: 'pipe' }))
async function checkMcp(name, args) {
  for (const tool of ['score_relevance', 'prune_history']) {
    await check(`mcp ${tool}`, name, async () => {
      const result = await client.callTool({ name: tool, arguments: args })
      const text = JSON.stringify(result.content)
      if (RAW.test(text)) throw new TypeError(text.slice(0, 200))
      if (result.isError) return { isError: true }
      return JSON.parse(result.content[0].text)
    }, { limitMs: 15_000, validate: (r) => (r.isError ? undefined : validDecisions(r.scored ?? r.decisions, args.entries)) })
  }
}
const mcpBase = () => [entry(0), entry(1), entry(2)].map(({ toolName, ...e }) => (toolName ? { ...e, toolName } : e))
for (const field of ['id', 'role', 'toolName', 'content', 'timestamp', 'sourceTokens']) {
  for (const [label, value] of Object.entries({ ...WRONG, 0: 0, '-1': -1, '1.5': 1.5, '1e308': 1e308, '-1e308': -1e308, 'huge string': 'x'.repeat(5000), unicode: Object.values(UNICODE).join(' ').slice(0, 3000) })) {
    const entries = mcpBase()
    entries[1] = withField(entries[1], field, value)
    await checkMcp(`entries[1].${field} = ${label}`, { goal: 'fix the checkout retry', entries })
  }
}
for (const [label, goal] of Object.entries({ ...WRONG, empty: '', huge: 'x'.repeat(5000), unicode: Object.values(UNICODE).join(' ').slice(0, 1500) })) await checkMcp(`goal = ${label}`, { goal, entries: mcpBase() })
for (const n of [0, 1, 500, 501]) await checkMcp(`${n} entries`, { goal: 'g', entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, role: 'tool', content: `c${i}`, timestamp: i })) })
for (const [label, value] of Object.entries({ ...WRONG, ...Object.fromEntries(Object.entries(NUMBERS).filter(([k]) => !['NaN', 'Infinity', '-Infinity'].includes(k))) })) {
  await checkMcp(`recencyWeight = ${label}`, { goal: 'g', entries: mcpBase(), recencyWeight: value })
  await checkMcp(`dropBelow = ${label}`, { goal: 'g', entries: mcpBase(), dropBelow: value })
}
await client.close()
jev.closeAllConnections()
jev.close()
rmSync(dir, { recursive: true, force: true })

// ---------------------------------------------------------------------------------------------

const total = Object.values(counts).reduce((a, b) => a + b, 0)
console.log(`${total} cases:`, Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '))
if (missing.size > 0) console.log(`skipped, not in this build: ${[...missing].join(', ')}`)
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ total, counts, violations }, null, 2)}\n`)
if (violations.length === 0) {
  console.log('no violations')
} else {
  console.log(`${violations.length} violations:`)
  for (const v of violations) console.log(`  ${v.point} :: ${v.case} — ${v.problem}`)
  process.exitCode = 1
}
process.on('exit', () => {
  if (process.exitCode && current) console.error(`(last case started: ${current})`)
})
