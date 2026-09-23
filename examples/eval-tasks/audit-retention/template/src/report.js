import { selectForPurge } from './retention.js'

// Monthly compliance report: counts per category, and how many are due for purge.
export function complianceReport(entries, now = Date.now()) {
  const byCategory = {}
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1
  return { total: entries.length, byCategory, duePurge: selectForPurge(entries, now).length }
}
