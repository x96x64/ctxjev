import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { selectForPurge } from '../src/retention.js'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 21, 2, 0, 0)
const aged = (ms, category = 'app', extra = {}) => ({ id: `${category}-${ms}`, category, createdAt: NOW - ms, ...extra })
const purged = (entry) => selectForPurge([entry], NOW).length === 1

test('keeps recent events', () => {
  assert.equal(purged(aged(3 * 60 * 60 * 1000)), false)
  assert.equal(purged(aged(30 * DAY_MS, 'login')), false)
})

test('purges ordinary events only once they are more than 90 full days old', () => {
  assert.equal(purged(aged(90 * DAY_MS)), false)
  assert.equal(purged(aged(90 * DAY_MS + 1)), true)
  assert.equal(purged(aged(120 * DAY_MS, 'export')), true)
})

test('keeps security events for 400 days', () => {
  assert.equal(purged(aged(200 * DAY_MS, 'security')), false)
  assert.equal(purged(aged(400 * DAY_MS, 'security')), false)
  assert.equal(purged(aged(401 * DAY_MS, 'security')), true)
})

test('never purges an event under legal hold', () => {
  assert.equal(purged(aged(1000 * DAY_MS, 'app', { legalHold: true })), false)
})

test('keeps the selectForPurge(entries, now) signature', () => {
  const entries = [aged(91 * DAY_MS), aged(1 * DAY_MS)]
  assert.deepEqual(selectForPurge(entries, NOW).map((e) => e.id), [entries[0].id])
})

test('leaves scripts/purge.js as it is', () => {
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'scripts/purge.js'], { stdio: 'pipe' }))
})
