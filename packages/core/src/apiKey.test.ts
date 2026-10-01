import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { missingTypesafeApiKey, typesafeApiKey } from './apiKey.js'
import { scoreRelevance } from './jevClient.js'
import type { Entry } from './types.js'

// Codex (0.159.3) hands an Agent Plugins bundle's `"TYPESAFE_API_KEY": "${TYPESAFE_API_KEY}"` to the
// MCP server literally, unexpanded. Taken for a key, it sent the masked goal and excerpts to Jev,
// which refused them; without a real key, nothing should have been sent at all.
describe('an unexpanded TYPESAFE_API_KEY placeholder', () => {
  const entries: Entry[] = [{ id: 'a', role: 'tool', content: 'chargeCustomer() is called twice on retry', timestamp: 0 }]
  const received: string[] = []
  let jev: Server

  beforeAll(async () => {
    // A stand-in for Jev that records every request it gets.
    jev = createServer((req, res) => {
      received.push(`${req.method} ${req.url} ${req.headers.authorization}`)
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"error":"unauthorized"}')
    })
    await new Promise<void>((resolve) => jev.listen(0, '127.0.0.1', resolve))
    vi.stubEnv('TYPESAFE_BASE_URL', `http://127.0.0.1:${(jev.address() as AddressInfo).port}`)
  })
  afterEach(() => {
    received.length = 0
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    jev.closeAllConnections()
    jev.close()
  })

  for (const placeholder of ['${TYPESAFE_API_KEY}', '$TYPESAFE_API_KEY', '%TYPESAFE_API_KEY%']) {
    it(`is no key, and Jev gets nothing: ${placeholder}`, async () => {
      vi.stubEnv('TYPESAFE_API_KEY', placeholder)
      await expect(scoreRelevance('fix the double charge', entries)).rejects.toThrow(/TYPESAFE_API_KEY/)
      expect(received).toEqual([])
    })
  }
})

describe('typesafeApiKey / missingTypesafeApiKey', () => {
  it('returns a real key, trimmed', () => {
    expect(typesafeApiKey({ TYPESAFE_API_KEY: '  tsk_live_abc123  ' })).toBe('tsk_live_abc123')
    expect(missingTypesafeApiKey({ TYPESAFE_API_KEY: 'tsk_live_abc123' })).toBeUndefined()
  })

  it('has no key when the variable is unset or blank', () => {
    for (const env of [{}, { TYPESAFE_API_KEY: '' }, { TYPESAFE_API_KEY: '   ' }]) {
      expect(typesafeApiKey(env)).toBeUndefined()
      expect(missingTypesafeApiKey(env)).toBe('TYPESAFE_API_KEY is not set')
    }
  })

  it('has no key when the value is only a variable reference, and names it', () => {
    for (const placeholder of ['${TYPESAFE_API_KEY}', '${env:TYPESAFE_API_KEY}', '$TYPESAFE_API_KEY', '%TYPESAFE_API_KEY%']) {
      expect(typesafeApiKey({ TYPESAFE_API_KEY: placeholder })).toBeUndefined()
      expect(missingTypesafeApiKey({ TYPESAFE_API_KEY: placeholder })).toBe(`TYPESAFE_API_KEY is ${JSON.stringify(placeholder)}, an unexpanded placeholder, not a key`)
    }
  })

  it('keeps a key that only contains a $ or % somewhere, and never quotes a real key back', () => {
    for (const key of ['tsk_$abc', 'abc$DEF', '${a}b', 'a%B%', '$1abc', '%1x%', '${tsk-live-9f8e7d6c}', '${}']) {
      expect(typesafeApiKey({ TYPESAFE_API_KEY: key })).toBe(key)
      expect(missingTypesafeApiKey({ TYPESAFE_API_KEY: key })).toBeUndefined()
    }
  })
})
