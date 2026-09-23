import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from '../src/db/index.js'
import { handleWebhook } from '../src/webhooks/handler.js'

const verifySignature = () => true
const delivery = (deliveryId, requestId, body) => ({ headers: { 'x-delivery-id': deliveryId, 'x-request-id': requestId }, body })
const capture = { type: 'payment.captured', data: { paymentId: 'p1', amount: 500 } }

test('a retried delivery (same X-Delivery-Id, new X-Request-Id) is applied once and still acknowledged with 200', async () => {
  const db = createDb()
  const first = await handleWebhook(delivery('dlv_1', 'req_a', capture), { db, verifySignature })
  const retry = await handleWebhook(delivery('dlv_1', 'req_b', capture), { db, verifySignature })
  assert.equal(first.status, 200)
  assert.equal(retry.status, 200)
  assert.equal(db.ledger.length, 1)
})

test('two different deliveries with identical payloads are both applied', async () => {
  const db = createDb()
  await handleWebhook(delivery('dlv_1', 'req_a', capture), { db, verifySignature })
  await handleWebhook(delivery('dlv_2', 'req_b', capture), { db, verifySignature })
  assert.equal(db.ledger.length, 2)
})

test('dedupe state lives in the db (shared by all instances), not in process memory', async () => {
  const shared = createDb()
  await handleWebhook(delivery('dlv_9', 'req_a', capture), { db: shared, verifySignature })
  // A fresh db (another environment, same process) must not see the first delivery as a duplicate.
  const other = createDb()
  await handleWebhook(delivery('dlv_9', 'req_b', capture), { db: other, verifySignature })
  assert.equal(other.ledger.length, 1)
})

test('marks deliveries seen for 24 hours via db.markSeen', async () => {
  const db = createDb()
  const calls = []
  const markSeen = db.markSeen
  db.markSeen = async (key, ttlMs) => { calls.push({ key, ttlMs }); return markSeen(key, ttlMs) }
  await handleWebhook(delivery('dlv_7', 'req_a', capture), { db, verifySignature })
  assert.equal(calls.length, 1)
  assert.match(calls[0].key, /dlv_7/)
  assert.equal(calls[0].ttlMs, 24 * 60 * 60 * 1000)
})
