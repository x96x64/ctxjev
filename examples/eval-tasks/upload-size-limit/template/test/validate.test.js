import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateUpload } from '../src/validate.js'

test('accepts a small image', () => {
  assert.deepEqual(validateUpload({ name: 'a.jpg', type: 'image/jpeg', size: 200_000 }), { ok: true })
})

test('rejects an unsupported type', () => {
  assert.equal(validateUpload({ name: 'a.exe', type: 'application/x-msdownload', size: 10 }).status, 415)
})
