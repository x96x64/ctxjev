import { COUPONS } from './catalog.js'

// cart: { items: [{ sku, price (cents), qty }] }
export function subtotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0)
}

// Returns { total (cents, before tax), applied: [codes that took effect] }.
export function applyCoupons(cart, codes) {
  let total = subtotal(cart)
  const applied = []
  for (const code of codes) {
    const coupon = COUPONS[code]
    if (!coupon) continue
    if (coupon.type === 'percent') total -= Math.round((total * coupon.value) / 100)
    else total -= coupon.value
    applied.push(code)
  }
  return { total, applied }
}
