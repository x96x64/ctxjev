import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shippingFee } from '../src/shipping.js'

test('都道府県ごとの送料', () => {
  assert.equal(shippingFee({ items: [{ sku: 'a', price: 1000, qty: 1 }], prefecture: '東京都' }), 600)
  assert.equal(shippingFee({ items: [{ sku: 'a', price: 1000, qty: 1 }], prefecture: '北海道' }), 1200)
})
