import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config.js'
import { logger } from '../src/logger.js'

function captureWarnings(fn) {
  const calls = []
  const original = logger.warn
  const originalConsole = console.warn
  let consoleCalls = 0
  logger.warn = (...args) => calls.push(args)
  console.warn = () => { consoleCalls++ }
  try { fn() } finally { logger.warn = original; console.warn = originalConsole }
  return { calls, consoleCalls }
}

test('SHOPAPI_POOL_MAX sets the pool size', () => {
  assert.equal(loadConfig({ SHOPAPI_POOL_MAX: '40' }).db.poolMax, 40)
})

test('SHOPAPI_POOL_MAX wins over POOL_MAX; POOL_MAX still works; one warning per process via logger.warn', () => {
  const { calls, consoleCalls } = captureWarnings(() => {
    assert.equal(loadConfig({ SHOPAPI_POOL_MAX: '40', POOL_MAX: '25' }).db.poolMax, 40)
    assert.equal(loadConfig({ POOL_MAX: '25' }).db.poolMax, 25)
    assert.equal(loadConfig({ POOL_MAX: '30' }).db.poolMax, 30)
  })
  assert.equal(consoleCalls, 0, 'the warning must go through logger.warn, not console')
  assert.equal(calls.length, 1, `expected exactly one deprecation warning, got ${calls.length}`)
  assert.match(JSON.stringify(calls), /POOL_MAX/)
})

test('defaults and other overrides still work', () => {
  assert.equal(loadConfig({}).db.poolMax, 10)
  assert.equal(loadConfig({ PORT: '8080' }).port, 8080)
})
