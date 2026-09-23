import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { shippingFee } from '../src/shipping.js'

const order = (price, prefecture = '東京都', extra = {}) => ({ items: [{ sku: 'x', price, qty: 1 }], prefecture, ...extra })

test('送料無料は税抜 5,000円以上で判定する', () => {
  assert.equal(shippingFee(order(4600)), 600)
  assert.equal(shippingFee(order(4999)), 600)
  assert.equal(shippingFee(order(5000)), 0)
})

test('沖縄県と離島は、送料無料の条件を満たしても中継料 800円がかかる', () => {
  assert.equal(shippingFee(order(6000, '沖縄県')), 800)
  assert.equal(shippingFee(order(6000, '東京都', { remoteIsland: true })), 800)
})

test('送料無料にならないときは通常の送料だけで、中継料は足さない', () => {
  assert.equal(shippingFee(order(3000, '沖縄県')), 1500)
  assert.equal(shippingFee(order(3000, '東京都', { remoteIsland: true })), 600)
})

test('送料無料の判定はクーポン適用後の税抜金額で行う', () => {
  assert.equal(shippingFee(order(5500, '東京都', { couponDiscount: 1000 })), 600)
  assert.equal(shippingFee(order(6500, '東京都', { couponDiscount: 1000 })), 0)
  assert.equal(shippingFee(order(5500, '大阪府')), 0)
})

test('返り値は円の整数', () => {
  assert.ok(Number.isInteger(shippingFee(order(1234, '福岡県'))))
})

test('config/regions.json は変更しない', () => {
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'config/regions.json'], { stdio: 'pipe' }))
})
