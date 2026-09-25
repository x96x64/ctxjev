import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addItem } from '../src/cart.js'

test('adds an item to an empty cart', () => {
  assert.deepEqual(addItem({ items: [] }, 'a'), { ok: true, cart: { items: ['a'] } })
})
