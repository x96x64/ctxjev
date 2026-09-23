// Process-wide settings from the environment. Anything per-user belongs in the flags service.
export function loadConfig(env = process.env) {
  return {
    currency: env.CURRENCY ?? 'USD',
    giftWrap: env.GIFT_WRAP === 'on',
    freeShippingThresholdCents: Number(env.FREE_SHIPPING_THRESHOLD_CENTS ?? 5000),
  }
}
