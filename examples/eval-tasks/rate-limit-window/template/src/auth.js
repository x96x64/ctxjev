// API keys are checked by the backend services; the gateway only forwards x-api-key.
export function apiKeyOf(req) {
  return req.headers['x-api-key'] || undefined
}
