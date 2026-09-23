// req: { headers, ip }. Headers are lower-case, as Node gives them.
export function rateLimit(limiter) {
  return (req, res, next) => {
    if (!limiter.check(req.ip)) {
      res.statusCode = 429
      res.end('Too Many Requests')
      return
    }
    next()
  }
}
