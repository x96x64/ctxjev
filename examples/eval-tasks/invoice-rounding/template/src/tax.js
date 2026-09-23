export const TAX_RATES = { CA: 0.0725, NY: 0.04, TX: 0.0625, WA: 0.065, OR: 0, DE: 0 }

export function taxRateFor(region) {
  if (!(region in TAX_RATES)) throw new Error(`unknown region ${region}`)
  return TAX_RATES[region]
}
