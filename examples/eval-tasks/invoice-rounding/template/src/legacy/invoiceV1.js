// Frozen: v1 API (/v1/invoices). Partners depend on its exact output, rounding quirks included.
export function totalV1(lines) {
  let total = 0
  for (const l of lines) total += Math.round(l.unitPrice * l.quantity * 100) / 100
  return Math.round(total * 100)
}
