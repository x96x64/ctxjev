import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from '../src/http/client.js'

test('returns the first successful response', async () => {
  assert.equal(await request(async () => 'ok', { sleep: async () => {} }), 'ok')
})
