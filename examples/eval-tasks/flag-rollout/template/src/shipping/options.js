import { loadConfig } from '../config.js'

const STANDARD = { id: 'standard', label: 'Standard (3-5 days)', priceCents: 499 }
const PICKUP = { id: 'pickup', label: 'Pick up in store', priceCents: 0 }
const EXPRESS = { id: 'express', label: 'Express (next day)', priceCents: 1499 }

// Options shown at checkout, in display order.
export function getShippingOptions(user, { flags, config = loadConfig() } = {}) {
  const options = [STANDARD, PICKUP]
  if (config.giftWrap) options.push({ id: 'gift', label: 'Gift wrap + standard', priceCents: 899 })
  return options
}

export { EXPRESS }
