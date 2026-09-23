import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLimiter } from '../src/rateLimiter.js'

test('allows up to the limit, then blocks', () => {
  const limiter = createLimiter({ limit: 3, windowMs: 1000, now: () => 0 })
  assert.deepEqual([1, 2, 3, 4].map(() => limiter.check('k')), [true, true, true, false])
})

test('counts keys separately', () => {
  const limiter = createLimiter({ limit: 1, windowMs: 1000, now: () => 0 })
  assert.equal(limiter.check('a'), true)
  assert.equal(limiter.check('b'), true)
})
