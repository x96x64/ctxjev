// When to retry a failed request, and how long to wait first.
export function shouldRetry(failure) {
  return true
}

export function delayFor(attempt) {
  return 100
}
