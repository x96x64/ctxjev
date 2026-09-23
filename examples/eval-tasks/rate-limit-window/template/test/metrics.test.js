import { test } from 'node:test'
import assert from 'node:assert/strict'
import { p95, recordLatency } from '../src/metrics.js'

test('p95 of recorded latencies', () => {
  for (let i = 1; i <= 100; i++) recordLatency('/x', i)
  assert.equal(p95('/x'), 96)
})
