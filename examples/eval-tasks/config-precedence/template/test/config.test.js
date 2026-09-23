import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config.js'

test('defaults', () => {
  assert.equal(loadConfig({}).db.poolMax, 10)
})

test('production file overrides the host', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production' }).db.host, 'db.internal')
})

test('PORT env var overrides the port', () => {
  assert.equal(loadConfig({ PORT: '8080' }).port, 8080)
})
