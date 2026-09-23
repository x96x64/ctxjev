import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectForPurge } from '../src/retention.js'

const DAY_MS = 24 * 60 * 60 * 1000

test('purges an event from long ago', () => {
  const now = 1000 * DAY_MS
  assert.equal(selectForPurge([{ id: 'a', category: 'app', createdAt: 0 }], now).length, 1)
})
