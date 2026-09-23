import { formatCents } from '../money.js'
import { computeTotal, lineAmount } from '../invoice.js'

export function renderInvoiceText(invoice) {
  const rows = invoice.lines.map((l) => `${l.description.padEnd(30)} ${String(l.quantity).padStart(4)} ${formatCents(Math.round(lineAmount(l) * 100))}`)
  return [`Invoice ${invoice.number}`, ...rows, `Total: ${formatCents(computeTotal(invoice.lines))}`].join('\n')
}
