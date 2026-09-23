import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from '../src/db/index.js'
import { handleWebhook } from '../src/webhooks/handler.js'

const verifySignature = () => true

test('applies a capture to the ledger', async () => {
  const db = createDb()
  const res = await handleWebhook({ headers: {}, body: { type: 'payment.captured', data: { paymentId: 'p1', amount: 500 } } }, { db, verifySignature })
  assert.equal(res.status, 200)
  assert.equal(db.ledger.length, 1)
})

test('rejects a bad signature', async () => {
  const res = await handleWebhook({ headers: {}, body: {} }, { db: createDb(), verifySignature: () => false })
  assert.equal(res.status, 401)
})
