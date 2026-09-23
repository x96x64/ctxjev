# edge-gateway

The HTTP gateway in front of the public API. It authenticates requests, applies rate limits, and
routes to the backend services.

- `src/rateLimiter.js`: per-key request counters
- `src/middleware.js`: the rate-limit middleware wired into `src/server.js`
- `config/limits.json`: limits, also read by the ops dashboard
- `npm test` runs the suite with node:test
