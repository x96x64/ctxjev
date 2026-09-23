import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCoupons } from '../src/coupons.js'

const cart = { items: [{ sku: 'mug', price: 1000, qty: 2 }] }

test('a single percentage coupon', () => {
  assert.deepEqual(applyCoupons(cart, ['SAVE10']), { total: 1800, applied: ['SAVE10'] })
})

test('unknown codes are ignored', () => {
  assert.deepEqual(applyCoupons(cart, ['NOPE']), { total: 2000, applied: [] })
})
