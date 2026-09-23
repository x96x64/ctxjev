import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toJstDate } from '../src/lib/date.js'

test('toJstDate は日本時間の暦日を返す', () => {
  assert.equal(toJstDate(new Date('2026-03-31T15:05:00Z')), '2026-04-01')
})
