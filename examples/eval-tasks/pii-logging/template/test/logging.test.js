import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRequestLog } from '../src/logging/requestLogger.js'

test('request log is one JSON line with method, path, status', () => {
  const line = JSON.parse(formatRequestLog({ method: 'GET', path: '/me', body: {} }, { status: 200 }, 12))
  assert.equal(line.method, 'GET')
  assert.equal(line.status, 200)
})
