import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { quotaBytes } from '../src/quota.js'
import { validateUpload } from '../src/validate.js'

const MIB = 1024 * 1024
const image = (size) => ({ name: 'IMG_1.HEIC', type: 'image/heic', size })
const pdf = (size) => ({ name: 'scan.pdf', type: 'application/pdf', size })

test('images up to exactly 10 MiB are accepted', () => {
  assert.deepEqual(validateUpload(image(10_207_334)), { ok: true })
  assert.deepEqual(validateUpload(image(10 * MIB)), { ok: true })
})

test('an image over 10 MiB gets 413 with the message the apps match on', () => {
  const result = validateUpload(image(10 * MIB + 1))
  assert.equal(result.ok, false)
  assert.equal(result.status, 413)
  assert.equal(result.error, 'File too large: max 10 MiB')
})

test('PDFs may be up to 25 MiB', () => {
  assert.deepEqual(validateUpload(pdf(18_874_368)), { ok: true })
  assert.deepEqual(validateUpload(pdf(25 * MIB)), { ok: true })
  const result = validateUpload(pdf(25 * MIB + 1))
  assert.equal(result.status, 413)
  assert.equal(result.error, 'File too large: max 25 MiB')
})

test('storage quotas stay in decimal gigabytes', () => {
  assert.equal(quotaBytes('free'), 1_000_000_000)
  assert.equal(quotaBytes('pro'), 5_000_000_000)
})

test('leaves config/upload.json as it is', () => {
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'config/upload.json'], { stdio: 'pipe' }))
})
