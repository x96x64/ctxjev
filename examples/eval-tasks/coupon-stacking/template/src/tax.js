const RATES = { CA: 0.0725, NY: 0.04, TX: 0.0625, OR: 0 }

export function salesTax(cents, state) {
  return Math.round(cents * (RATES[state] ?? 0))
}
