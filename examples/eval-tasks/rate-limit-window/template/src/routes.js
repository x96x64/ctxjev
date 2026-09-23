import { recordLatency } from './metrics.js'

const BACKENDS = { '/v2/orders': 'http://orders.internal:9000', '/v2/users': 'http://users.internal:9001' }

export function route(req, res) {
  const started = Date.now()
  if (req.url === '/healthz') {
    res.end('ok')
    return
  }
  const prefix = Object.keys(BACKENDS).find((p) => req.url.startsWith(p))
  if (!prefix) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  res.setHeader('x-backend', BACKENDS[prefix])
  res.end()
  recordLatency(prefix, Date.now() - started)
}
