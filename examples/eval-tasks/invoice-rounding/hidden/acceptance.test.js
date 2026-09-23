import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { computeTotal } from '../src/invoice.js'

const line = (unitPrice, quantity = 1, taxRate = 0) => ({ description: 'x', unitPrice, quantity, taxRate })

test('rounds each line to cents with round-half-even, then sums', () => {
  // 12.5c per line: half-even -> 12 each (24). Summing first gives 25; half-up per line gives 26.
  assert.equal(computeTotal([line(0.125), line(0.125)]), 24)
  // 37.5c -> 38 (even), 62.5c -> 62 (even)
  assert.equal(computeTotal([line(0.375), line(0.625)]), 100)
})

test('matches the ledger for the invoices in the reconciliation log', () => {
  assert.equal(computeTotal([line(0.125), line(0.125), line(2.5, 2), line(4.85)]), 1009)
  assert.equal(computeTotal([line(15.0625), line(15.0625)]), 3012)
})

test('keeps the computeTotal(lines) signature and integer-cents result', () => {
  assert.equal(computeTotal.length, 1)
  assert.ok(Number.isInteger(computeTotal([line(10, 1, 0.08)])))
  assert.equal(computeTotal([line(10, 1, 0.08)]), 1080)
})

test('leaves src/legacy untouched', () => {
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src/legacy'], { stdio: 'pipe' }))
})
