import { REGIONS } from './regions.js'

const FREE_SHIPPING_THRESHOLD = 5000
const TAX_RATE = 0.1
const DEFAULT_FEE = 800

// order: { items: [{ sku, price (税抜・円), qty }], prefecture: '東京都', remoteIsland: false }
// 送料（円の整数）を返す。
export function shippingFee(order) {
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0)
  const withTax = Math.floor(subtotal * (1 + TAX_RATE))
  if (withTax >= FREE_SHIPPING_THRESHOLD) return 0
  return REGIONS[order.prefecture]?.fee ?? DEFAULT_FEE
}
