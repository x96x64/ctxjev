import { describe, expect, it } from 'vitest'
import { AUDIT3_FORMATS, AUDIT3_LINES, FORMATS, HARMLESS, PW } from '../test/redactCases.js'
import { redactSecrets } from './redact.js'

describe('redactSecrets', () => {
  it('masks recognizable API key formats', () => {
    expect(redactSecrets('key is sk-ant-api03-abcdefghijklmnopqrstuv')).toBe('key is [REDACTED]')
    expect(redactSecrets('token ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe('token [REDACTED]')
    expect(redactSecrets('AKIAABCDEFGHIJKLMNOP in config')).toBe('[REDACTED] in config')
    expect(redactSecrets('xoxb-1234567890-abcdefghij')).toBe('[REDACTED]')
  })

  it('masks the value of a credential-named assignment but keeps the name', () => {
    expect(redactSecrets('export TYPESAFE_API_KEY=abc123def456ghi')).toBe('export TYPESAFE_API_KEY=[REDACTED]')
    expect(redactSecrets('password: "hunter2hunter2"')).toBe('password: "[REDACTED]"')
  })

  it('masks the value of a Japanese credential label but not Japanese prose after one', () => {
    expect(redactSecrets('パスワード：hunter2hunter2 です')).toBe('パスワード：[REDACTED] です')
    expect(redactSecrets('APIキー: "abc123def456ghi"')).toBe('APIキー: "[REDACTED]"')
    expect(redactSecrets('トークン：有効期限切れのため再発行')).toBe('トークン：有効期限切れのため再発行')
    const once = redactSecrets('秘密鍵=abc123def456ghi')
    expect(once).toBe('秘密鍵=[REDACTED]')
    expect(redactSecrets(once)).toBe(once)
  })

  it('masks bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toBe('Authorization: Bearer [REDACTED]')
  })

  it('masks a private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----'
    expect(redactSecrets(`here: ${pem} done`)).toBe('here: [REDACTED] done')
  })

  it('leaves ordinary text and numeric settings alone', () => {
    expect(redactSecrets('ran npm test — 12 passed, 0 failed')).toBe('ran npm test — 12 passed, 0 failed')
    expect(redactSecrets('maxTokens=100000')).toBe('maxTokens=100000')
    expect(redactSecrets('859 input tokens, 123 output tokens')).toBe('859 input tokens, 123 output tokens')
  })

  it('is idempotent', () => {
    const once = redactSecrets('TYPESAFE_API_KEY=sk-abcdefghijklmnopqrstuvwxyz')
    expect(redactSecrets(once)).toBe(once)
  })
})

describe('redactSecrets: the audit’s secret formats', () => {
  it('covers the 40 formats of the first audit, the 10 the second added, and 1 found since', () => {
    expect(FORMATS).toHaveLength(51)
    expect(new Set(FORMATS.map((f) => f.name)).size).toBe(51)
  })

  it.each(FORMATS)('masks $name', ({ text, secret }) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(masked).toContain('[REDACTED]')
    expect(redactSecrets(masked)).toBe(masked)
  })

  it('keeps the name of what was masked', () => {
    expect(redactSecrets(`{"password": "${PW}"}`)).toBe('{"password": "[REDACTED]"}')
    expect(redactSecrets(`DATABASE_URL=postgres://admin:${PW}@db.internal:5432/app`)).toBe('DATABASE_URL=postgres://admin:[REDACTED]@db.internal:5432/app')
    expect(redactSecrets('DB_PASS=hunter2')).toBe('DB_PASS=[REDACTED]')
    expect(redactSecrets(`mysql -u root -p${PW} orders`)).toBe('mysql -u root -p[REDACTED] orders')
  })

  it('masks a password that itself contains "@" in a URL', () => {
    expect(redactSecrets('postgres://admin:p@ss@db:5432/app')).toBe('postgres://admin:[REDACTED]@db:5432/app')
  })

  it('masks credentials inside escaped JSON', () => {
    const masked = redactSecrets(`{\\"password\\": \\"${PW}\\"}`)
    expect(masked).not.toContain(PW)
    expect(masked).toBe('{\\"password\\": \\"[REDACTED]\\"}')
  })
})

describe('redactSecrets: leaves ordinary text alone', () => {
  it.each(HARMLESS)('%s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})

// The third audit: a label that isn't a credential ("Error:", "env:", "https:") swallowed the
// assignment after it, so the credential in it was never looked at.
describe('redactSecrets: the third audit\'s lines', () => {
  const cases = AUDIT3_LINES.flatMap(({ text, secret }) => [
    { text, secret },
    { text: `out: ${text}`, secret },
  ])
  it.each(cases)('masks $text', ({ text, secret }) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(masked).toContain('[REDACTED]')
    expect(redactSecrets(masked)).toBe(masked)
  })

  it('keeps the labels and names around what it masked', () => {
    expect(redactSecrets('Error: DB_PASSWORD=hunter22')).toBe('Error: DB_PASSWORD=[REDACTED]')
    expect(redactSecrets('error: password: hunter22')).toBe('error: password: [REDACTED]')
    expect(redactSecrets('https://x.example.com/cb?access_token=abcd1234efgh5678')).toBe('https://x.example.com/cb?access_token=[REDACTED]')
  })

  it.each(AUDIT3_FORMATS)('masks $name', ({ text, secret }) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(masked).toContain('[REDACTED]')
    expect(redactSecrets(masked)).toBe(masked)
  })
})

// Every repeating quantifier is bounded or anchored: before, 100,000 characters of `a.a.a.…` took
// 24 seconds (an unbounded assignment name re-tried at every dot), so a long minified or dotted
// line could hold up a hook. Generous limits: the point is linear against quadratic, not speed.
describe('redactSecrets: time on long runs', () => {
  const N = 200_000
  const runs: Array<[string, string]> = [
    ['a.a.a…', 'a.'.repeat(N / 2)],
    ['a-a-a…', 'a-'.repeat(N / 2)],
    ['a:a:a…', 'a:'.repeat(N / 2)],
    ['x:tokenx:…', 'x:tokenx:'.repeat(N / 9)],
    ['Error: …', 'Error: '.repeat(N / 7)],
    ['a://b:…', 'a://b:'.repeat(N / 6)],
    ['mysql …', 'mysql '.repeat(N / 6)],
    ['"a": "…', '"a": "'.repeat(N / 6)],
    ['█…', '█'.repeat(N)],
  ]
  it.each(runs)('%s (200,000 characters) in under 2 seconds', (_name, text) => {
    const start = performance.now()
    redactSecrets(text)
    expect(performance.now() - start).toBeLessThan(2000)
  })
})
