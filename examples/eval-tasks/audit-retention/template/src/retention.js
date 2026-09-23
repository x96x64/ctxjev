const DAY = 24 * 60 * 60

// entries: [{ id, category, createdAt (ms since epoch), legalHold? }]
// Returns the entries the nightly purge should delete.
export function selectForPurge(entries, now = Date.now()) {
  const cutoff = now - 90 * DAY
  return entries.filter((entry) => entry.createdAt < cutoff)
}
