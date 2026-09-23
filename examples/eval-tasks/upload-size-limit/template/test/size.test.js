import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSize } from '../src/size.js'

test('parses sizes', () => {
  assert.equal(parseSize('512KB'), 512_000)
  assert.equal(parseSize('2 GB'), 2_000_000_000)
})
