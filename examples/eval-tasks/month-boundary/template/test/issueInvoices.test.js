import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issueInvoices } from '../src/billing/issueInvoices.js'

test('請求日の顧客だけ発行する', () => {
  const now = () => new Date('2026-09-10T03:00:00Z')
  const out = issueInvoices([{ id: 'c1', billingDay: 10, monthlyFee: 3000 }, { id: 'c2', billingDay: 11, monthlyFee: 5000 }], { now })
  assert.deepEqual(out, [{ customerId: 'c1', issueDate: '2026-09-10', amount: 3000 }])
})
