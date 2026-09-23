import { toCents } from './money.js'

// line: { description, unitPrice (dollars), quantity, taxRate (0.08 = 8%) }
export function lineAmount(line) {
  return line.unitPrice * line.quantity * (1 + line.taxRate)
}

// Total in integer cents. Called by the billing API, the PDF renderer, and reconciliation.
export function computeTotal(lines) {
  const raw = lines.reduce((sum, line) => sum + lineAmount(line), 0)
  return toCents(raw)
}
