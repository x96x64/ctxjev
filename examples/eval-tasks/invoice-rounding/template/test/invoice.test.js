import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeTotal, lineAmount } from '../src/invoice.js'

test('single line without tax', () => {
  assert.equal(computeTotal([{ description: 'Widget', unitPrice: 12.5, quantity: 2, taxRate: 0 }]), 2500)
})

test('line amount includes tax', () => {
  assert.equal(lineAmount({ description: 'Gadget', unitPrice: 10, quantity: 1, taxRate: 0.08 }).toFixed(2), '10.80')
})
