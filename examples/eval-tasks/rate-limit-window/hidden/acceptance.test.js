import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rateLimit } from '../src/middleware.js'
import { createLimiter } from '../src/rateLimiter.js'

function setup() {
  let t = 0
  const guard = rateLimit(createLimiter({ limit: 100, windowMs: 60_000, now: () => t }))
  const call = (headers = {}, ip = '10.0.0.1') => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = String(value)
      },
      writeHead(status, headers = {}) {
        this.statusCode = status
        for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = String(v)
        return this
      },
      end() {
        this.ended = true
      },
    }
    let passed = false
    guard({ headers, ip, socket: { remoteAddress: ip } }, res, () => (passed = true))
    return { passed, status: passed ? 200 : res.statusCode, retryAfter: res.headers['retry-after'] }
  }
  return { call, at: (ms) => (t = ms) }
}

test('the limit resets when the 60-second window ends, not hours later', () => {
  const { call, at } = setup()
  for (let i = 0; i < 100; i++) assert.equal(call({ 'x-api-key': 'k1' }).passed, true)
  assert.equal(call({ 'x-api-key': 'k1' }).status, 429)
  at(61_000)
  assert.equal(call({ 'x-api-key': 'k1' }).passed, true)
})

test('a blocked request gets Retry-After in whole seconds, rounded up, never 0', () => {
  const { call, at } = setup()
  for (let i = 0; i < 100; i++) call({ 'x-api-key': 'k1' })
  const first = call({ 'x-api-key': 'k1' })
  assert.equal(first.status, 429)
  assert.equal(first.retryAfter, '60')
  at(59_500)
  const late = call({ 'x-api-key': 'k1' })
  assert.equal(late.status, 429)
  assert.equal(late.retryAfter, '1')
})

test('limits by API key, so clients behind one IP do not block each other', () => {
  const { call } = setup()
  for (let i = 0; i < 100; i++) call({ 'x-api-key': 'k1' }, '203.0.113.9')
  assert.equal(call({ 'x-api-key': 'k1' }, '203.0.113.9').status, 429)
  assert.equal(call({ 'x-api-key': 'k2' }, '203.0.113.9').passed, true)
  assert.equal(call({ 'x-api-key': 'k1' }, '198.51.100.4').status, 429)
})

test('falls back to the IP when there is no API key', () => {
  const { call } = setup()
  for (let i = 0; i < 100; i++) call({}, '10.0.0.7')
  assert.equal(call({}, '10.0.0.7').status, 429)
  assert.equal(call({}, '10.0.0.8').passed, true)
})

test('never limits the internal health checker', () => {
  const { call } = setup()
  for (let i = 0; i < 150; i++) assert.equal(call({ 'x-internal-health': '1' }).passed, true)
})

test('leaves config/limits.json as it is', () => {
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'config/limits.json'], { stdio: 'pipe' }))
})
