import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCoupons } from '../src/coupons.js'

const cartOf = (cents) => ({ items: [{ sku: 'x', price: cents, qty: 1 }] })
const sorted = (codes) => [...codes].sort()

test('percentage coupons apply to the subtotal before fixed-amount ones', () => {
  assert.equal(applyCoupons(cartOf(10000), ['WELCOME5', 'SAVE10']).total, 8500)
})

test('only the largest percentage coupon counts', () => {
  const result = applyCoupons(cartOf(10000), ['SAVE10', 'HALF', 'SPRING20'])
  assert.equal(result.total, 5000)
  assert.deepEqual(result.applied, ['HALF'])
})

test('fixed-amount coupons together take off at most half the subtotal', () => {
  assert.equal(applyCoupons(cartOf(3000), ['BIGSPENDER', 'WELCOME5']).total, 1500)
  assert.equal(applyCoupons(cartOf(10000), ['BIGSPENDER', 'WELCOME5']).total, 7500)
})

test('the total never goes below zero', () => {
  const result = applyCoupons(cartOf(3000), ['BIGSPENDER', 'WELCOME5', 'HALF'])
  assert.equal(result.total, 0)
  assert.deepEqual(sorted(result.applied), ['BIGSPENDER', 'HALF', 'WELCOME5'])
})

test('a code entered twice counts once', () => {
  const result = applyCoupons(cartOf(10000), ['FIVEOFF', 'FIVEOFF', 'FIVEOFF'])
  assert.equal(result.total, 9500)
  assert.deepEqual(result.applied, ['FIVEOFF'])
})

test('keeps returning { total, applied } in integer cents', () => {
  const result = applyCoupons({ items: [{ sku: 'a', price: 1250, qty: 2 }] }, ['SPRING20', 'NOPE'])
  assert.deepEqual(Object.keys(result).sort(), ['applied', 'total'])
  assert.equal(result.total, 2000)
  assert.ok(Number.isInteger(result.total))
})
