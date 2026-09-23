import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getShippingOptions } from '../src/shipping/options.js'
import { createFlags } from '../src/flags/client.js'

const config = { giftWrap: false }
const ids = (user, flags) => getShippingOptions(user, { flags, config }).map((o) => o.id)

test('express is shown when the express-shipping flag is on for the user', () => {
  assert.ok(ids({ id: 'beta1' }, createFlags({ 'express-shipping': { users: ['beta1'] } })).includes('express'))
})

test('express is hidden when the flag is off, even with the old env var set', () => {
  process.env.EXPRESS_SHIPPING = 'on'
  try {
    assert.ok(!ids({ id: 'u2' }, createFlags({ 'express-shipping': { users: ['beta1'] } })).includes('express'))
    assert.ok(!ids({ id: 'u2' }, createFlags()).includes('express'))
  } finally {
    delete process.env.EXPRESS_SHIPPING
  }
})

test('standard stays first', () => {
  assert.equal(ids({ id: 'beta1' }, createFlags({ 'express-shipping': { users: ['beta1'] } }))[0], 'standard')
})
