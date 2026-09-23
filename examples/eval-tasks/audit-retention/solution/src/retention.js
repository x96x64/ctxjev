const DAY_MS = 24 * 60 * 60 * 1000
// From legal: security events are kept 400 days, everything else 90.
const RETENTION_DAYS = { security: 400 }
const DEFAULT_RETENTION_DAYS = 90

// entries: [{ id, category, createdAt (ms since epoch), legalHold? }]
// Returns the entries the nightly purge should delete: more than their retention period old, and
// not under legal hold.
export function selectForPurge(entries, now = Date.now()) {
  return entries.filter((entry) => {
    if (entry.legalHold) return false
    const days = RETENTION_DAYS[entry.category] ?? DEFAULT_RETENTION_DAYS
    return now - entry.createdAt > days * DAY_MS
  })
}
