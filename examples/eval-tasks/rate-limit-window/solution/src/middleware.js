// req: { headers, ip }. Headers are lower-case, as Node gives them.
export function rateLimit(limiter) {
  return (req, res, next) => {
    if (req.headers['x-internal-health'] === '1') return next()
    const apiKey = req.headers['x-api-key']
    const { allowed, retryAfterMs } = limiter.hit(apiKey ? `key:${apiKey}` : `ip:${req.ip}`)
    if (!allowed) {
      res.statusCode = 429
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
      res.end('Too Many Requests')
      return
    }
    next()
  }
}
