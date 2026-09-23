import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getShippingOptions } from '../src/shipping/options.js'
import { createFlags } from '../src/flags/client.js'

test('standard comes first', () => {
  const ids = getShippingOptions({ id: 'u1' }, { flags: createFlags(), config: { giftWrap: false } }).map((o) => o.id)
  assert.equal(ids[0], 'standard')
})
