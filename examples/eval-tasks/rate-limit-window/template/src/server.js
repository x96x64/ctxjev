import { createServer } from 'node:http'
import { limits } from './config.js'
import { rateLimit } from './middleware.js'
import { createLimiter } from './rateLimiter.js'
import { route } from './routes.js'

const guard = rateLimit(createLimiter(limits))

export const server = createServer((req, res) => {
  req.ip = req.socket.remoteAddress
  guard(req, res, () => route(req, res))
})

if (process.argv[1]?.endsWith('server.js')) server.listen(Number(process.env.PORT ?? 8080))
