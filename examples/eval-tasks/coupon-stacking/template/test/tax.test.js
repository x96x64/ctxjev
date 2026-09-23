import { test } from 'node:test'
import assert from 'node:assert/strict'
import { salesTax } from '../src/tax.js'

test('rounds tax to cents', () => {
  assert.equal(salesTax(1999, 'CA'), 145)
})
