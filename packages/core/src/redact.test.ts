import { describe, expect, it } from 'vitest'
import { FORMATS, HARMLESS, PW } from '../test/redactCases.js'
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
  it('covers 40 formats', () => {
    expect(FORMATS).toHaveLength(40)
    expect(new Set(FORMATS.map((f) => f.name)).size).toBe(40)
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
