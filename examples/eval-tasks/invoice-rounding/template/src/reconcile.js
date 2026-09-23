import { computeTotal } from './invoice.js'

// Nightly job: compares our totals with the finance ledger export.
export function reconcile(invoices, ledger) {
  const mismatches = []
  for (const inv of invoices) {
    const ours = computeTotal(inv.lines)
    const theirs = ledger[inv.number]
    if (theirs !== undefined && theirs !== ours) mismatches.push({ number: inv.number, ours, theirs })
  }
  return mismatches
}
