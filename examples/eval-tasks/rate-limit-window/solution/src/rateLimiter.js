// Fixed-window request counter per key. Windows are aligned to multiples of windowMs.
export function createLimiter({ limit, windowMs, now = Date.now }) {
  const counts = new Map()

  function hit(key) {
    const t = now()
    const window = Math.floor(t / windowMs)
    let entry = counts.get(key)
    if (!entry || entry.window !== window) {
      entry = { window, count: 0 }
      counts.set(key, entry)
    }
    entry.count++
    return { allowed: entry.count <= limit, retryAfterMs: (window + 1) * windowMs - t }
  }

  return { hit, check: (key) => hit(key).allowed }
}
