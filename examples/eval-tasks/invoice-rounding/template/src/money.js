// Dollars -> integer cents.
export function toCents(amount) {
  return Math.round(amount * 100)
}

export function formatCents(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}
