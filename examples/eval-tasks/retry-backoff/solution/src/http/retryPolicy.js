export const MAX_ATTEMPTS = 5
const RETRYABLE_STATUS = new Set([429, 503])

// When to retry a failed request, and how long to wait first.
export function shouldRetry(failure) {
  if (failure?.status !== undefined) return RETRYABLE_STATUS.has(failure.status)
  return Boolean(failure?.code) // network error
}

// Exponential from 200ms, capped at 5s, then +/-20% jitter. `random` returns [0, 1].
export function delayFor(attempt, random = Math.random) {
  const base = Math.min(200 * 2 ** (attempt - 1), 5000)
  return Math.round(base * (0.8 + 0.4 * random()))
}
