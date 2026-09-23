import { REGIONS } from './regions.js'

// 税抜・クーポン適用後の金額で判定する。
const FREE_SHIPPING_THRESHOLD = 5000
// 沖縄県と離島は、送料無料でも中継料がかかる。
const RELAY_FEE = 800
const RELAY_PREFECTURES = new Set(['沖縄県'])
const DEFAULT_FEE = 800

// order: { items: [{ sku, price (税抜・円), qty }], prefecture: '東京都', remoteIsland: false, couponDiscount?: 税抜・円 }
// 送料（円の整数）を返す。
export function shippingFee(order) {
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0)
  const afterCoupon = subtotal - (order.couponDiscount ?? 0)
  if (afterCoupon >= FREE_SHIPPING_THRESHOLD) {
    return order.remoteIsland || RELAY_PREFECTURES.has(order.prefecture) ? RELAY_FEE : 0
  }
  return REGIONS[order.prefecture]?.fee ?? DEFAULT_FEE
}
