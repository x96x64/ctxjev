import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from '../src/http/client.js'
import { delayFor, shouldRetry } from '../src/http/retryPolicy.js'

// Gives up after 50 sleeps, so a retry loop with no limit fails the test instead of running forever.
function boundedSleep() {
  let calls = 0
  return async () => {
    if (++calls > 50) throw new Error('retried more than 50 times')
  }
}

test('retries only 429, 503 and network errors', () => {
  assert.equal(shouldRetry({ status: 429 }), true)
  assert.equal(shouldRetry({ status: 503 }), true)
  assert.equal(shouldRetry({ code: 'ECONNRESET' }), true)
  assert.equal(shouldRetry({ status: 400 }), false)
  assert.equal(shouldRetry({ status: 500 }), false)
})

test('at most 5 attempts in total, including the first', async () => {
  let attempts = 0
  await assert.rejects(request(async () => { attempts++; throw { status: 503 } }, { sleep: boundedSleep(), random: () => 0.5 }))
  assert.equal(attempts, 5)
})

test('a 400 is not retried', async () => {
  let attempts = 0
  await assert.rejects(request(async () => { attempts++; throw { status: 400 } }, { sleep: boundedSleep(), random: () => 0.5 }))
  assert.equal(attempts, 1)
})

// Within a millisecond: the spec is in milliseconds and doesn't ask for rounding.
const about = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1, `expected ~${expected}, got ${actual}`)

test('exponential backoff from 200ms, capped at 5s, with +/-20% jitter', () => {
  about(delayFor(1, () => 0.5), 200)
  about(delayFor(2, () => 0.5), 400)
  about(delayFor(3, () => 0.5), 800)
  about(delayFor(10, () => 0.5), 5000)
  about(delayFor(1, () => 0), 160)
  about(delayFor(1, () => 1), 240)
})
