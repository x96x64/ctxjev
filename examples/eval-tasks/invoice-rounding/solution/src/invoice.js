// line: { description, unitPrice (dollars), quantity, taxRate (0.08 = 8%) }
export function lineAmount(line) {
  return line.unitPrice * line.quantity * (1 + line.taxRate)
}

function roundHalfEven(x) {
  const floor = Math.floor(x)
  const diff = x - floor
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1
  return Math.round(x)
}

// Total in integer cents: each line rounded to cents (round half to even), as the ledger does.
export function computeTotal(lines) {
  return lines.reduce((sum, line) => sum + roundHalfEven(lineAmount(line) * 100), 0)
}
