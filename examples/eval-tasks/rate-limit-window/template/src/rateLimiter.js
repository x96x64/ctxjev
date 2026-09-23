// Fixed-window request counter per key.
export function createLimiter({ limit, windowMs, now = Date.now }) {
  const counts = new Map()
  return {
    // true if the request is allowed
    check(key) {
      const window = Math.floor(now() / 1000 / windowMs)
      const entry = counts.get(key)
      if (!entry || entry.window !== window) {
        counts.set(key, { window, count: 1 })
        return true
      }
      entry.count++
      return entry.count <= limit
    },
  }
}
