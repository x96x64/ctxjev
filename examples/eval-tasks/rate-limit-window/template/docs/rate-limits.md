# Rate limits

Public API clients are limited to the number of requests in `config/limits.json` per window. A
limited request gets HTTP 429. Clients should back off and retry.

History: limits moved from nginx into the gateway in 2.7.0 (2026-08).
