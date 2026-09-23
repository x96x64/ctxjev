import { COUPONS } from './catalog.js'

// cart: { items: [{ sku, price (cents), qty }] }
export function subtotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0)
}

// Returns { total (cents, before tax), applied: [codes that took effect] }.
// Finance rules: only the largest percentage coupon counts, applied to the subtotal first; fixed
// coupons together take off at most half the subtotal; a repeated code counts once; never below 0.
export function applyCoupons(cart, codes) {
  const sub = subtotal(cart)
  const known = [...new Set(codes)].filter((code) => COUPONS[code])
  const percent = known.filter((c) => COUPONS[c].type === 'percent').sort((a, b) => COUPONS[b].value - COUPONS[a].value)[0]
  const fixed = known.filter((c) => COUPONS[c].type === 'fixed')

  let total = sub
  if (percent) total -= Math.round((sub * COUPONS[percent].value) / 100)
  const fixedOff = Math.min(fixed.reduce((sum, c) => sum + COUPONS[c].value, 0), Math.floor(sub / 2))
  total = Math.max(0, total - fixedOff)
  return { total, applied: [...(percent ? [percent] : []), ...fixed] }
}
