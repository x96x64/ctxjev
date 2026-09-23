// In-memory fake of the Postgres-backed store. Production swaps in src/db/pg.js with the same API.
export function createDb() {
  const seen = new Map() // key -> expiresAt (ms)
  const ledger = []
  return {
    // Records a key for ttlMs. Used by the email sender to avoid double sends.
    async markSeen(key, ttlMs) {
      seen.set(key, Date.now() + ttlMs)
    },
    async hasSeen(key) {
      const expiresAt = seen.get(key)
      return expiresAt !== undefined && expiresAt > Date.now()
    },
    async appendLedger(entry) {
      ledger.push(entry)
    },
    ledger,
    _seen: seen,
  }
}
