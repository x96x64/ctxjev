import { test } from 'node:test'
import assert from 'node:assert/strict'
import { complianceReport } from '../src/report.js'

test('counts per category', () => {
  const report = complianceReport([{ id: 'a', category: 'login', createdAt: 0 }, { id: 'b', category: 'login', createdAt: 0 }], 0)
  assert.deepEqual(report.byCategory, { login: 2 })
})
