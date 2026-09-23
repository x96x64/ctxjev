import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimatedDelivery } from '../src/delivery.js'

test('月末をまたぐお届け予定日', () => {
  assert.equal(estimatedDelivery('沖縄県', '2026-09-28'), '2026-10-02')
})
