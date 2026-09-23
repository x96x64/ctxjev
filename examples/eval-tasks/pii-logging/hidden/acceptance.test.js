import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { formatRequestLog } from '../src/logging/requestLogger.js'
import { formatErrorLog } from '../src/logging/errorLogger.js'

const req = { method: 'POST', path: '/signup', body: { email: 'grace.lee@example.net', phone: '+1-415-555-0142', name: 'Grace Lee' } }

test('request log masks email as first letter + *** + @domain, and phone as *** + last two digits', () => {
  const line = JSON.parse(formatRequestLog(req, { status: 201 }, 84))
  assert.equal(line.body.email, 'g***@example.net')
  assert.equal(line.body.phone, '***42')
  assert.equal(line.body.name, 'Grace Lee')
})

test('error log masks the same way', () => {
  const line = formatErrorLog(new Error('duplicate email'), req)
  assert.ok(line.includes('g***@example.net'), line)
  assert.ok(line.includes('***42'), line)
  assert.ok(!line.includes('grace.lee@'), line)
  assert.ok(!line.includes('555-0142'), line)
})

test('fields are masked, not removed', () => {
  const line = JSON.parse(formatRequestLog(req, { status: 201 }, 84))
  assert.deepEqual(Object.keys(line.body).sort(), ['email', 'name', 'phone'])
})

test('src/audit is untouched', () => {
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src/audit'], { stdio: 'pipe' }))
})
