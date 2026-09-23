import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcile } from '../src/reconcile.js'

test('no mismatch when totals agree', () => {
  const inv = { number: 'INV-1', lines: [{ description: 'A', unitPrice: 5, quantity: 1, taxRate: 0 }] }
  assert.deepEqual(reconcile([inv], { 'INV-1': 500 }), [])
})
