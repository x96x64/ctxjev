import { applyEvent } from './apply.js'

const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000 // PayRail retries a delivery for up to 24 hours

// POST /webhooks/payrail. `req` is { headers, body }; returns { status, body }.
export async function handleWebhook(req, { db, verifySignature }) {
  if (!verifySignature(req)) return { status: 401, body: { error: 'bad signature' } }
  const deliveryId = req.headers['x-delivery-id']
  const key = deliveryId && `payrail-delivery:${deliveryId}`
  if (key && (await db.hasSeen(key))) return { status: 200, body: { ok: true, duplicate: true } }
  await applyEvent(req.body, { db })
  if (key) await db.markSeen(key, DEDUPE_TTL_MS)
  return { status: 200, body: { ok: true } }
}
