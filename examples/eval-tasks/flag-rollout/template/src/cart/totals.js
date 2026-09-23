export function cartTotalCents(items, shipping, { freeShippingThresholdCents }) {
  const subtotal = items.reduce((s, i) => s + i.priceCents * i.quantity, 0)
  const shippingCents = subtotal >= freeShippingThresholdCents && shipping.id === 'standard' ? 0 : shipping.priceCents
  return subtotal + shippingCents
}
