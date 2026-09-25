import { readFileSync } from 'node:fs'

const { maxItems } = JSON.parse(readFileSync(new URL('../config/limits.json', import.meta.url), 'utf8'))

export function addItem(cart, item) {
  if (cart.items.length >= maxItems) return { ok: false, error: 'CART_FULL' }
  return { ok: true, cart: { items: [...cart.items, item] } }
}
