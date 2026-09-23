import { applyEvent } from './apply.js'

// POST /webhooks/payrail. `req` is { headers, body } (header names lowercased, as Node's http gives them);
// returns { status, body }.
export async function handleWebhook(req, { db, verifySignature }) {
  if (!verifySignature(req)) return { status: 401, body: { error: 'bad signature' } }
  const event = req.body
  await applyEvent(event, { db })
  return { status: 200, body: { ok: true } }
}
