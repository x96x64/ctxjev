import { applyCoupons, subtotal } from './coupons.js'
import { salesTax } from './tax.js'

const usd = (cents) => `$${(cents / 100).toFixed(2)}`

export function receiptLines(cart, codes, state) {
  const { total, applied } = applyCoupons(cart, codes)
  const tax = salesTax(total, state)
  return [`Subtotal ${usd(subtotal(cart))}`, ...applied.map((c) => `Coupon ${c}`), `Tax ${usd(tax)}`, `Total ${usd(total + tax)}`]
}
