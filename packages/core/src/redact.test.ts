import { describe, expect, it } from 'vitest'
import { AUDIT3_FORMATS, AUDIT3_LINES, B62, FORMATS, HARMLESS, PW, j } from '../test/redactCases.js'
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
    ['.netrc password lines…', `machine h\n${'password x\n'.repeat(N / 11)}`],
    ['Cookie: a=b; …', `Cookie: ${'a=b; '.repeat(N / 5)}`],
    ['.pgpass lines…', 'h:5432:d:u:p\n'.repeat(N / 13)],
    [' --token …', ' --token '.repeat(N / 9)],
  ]
  it.each(runs)('%s (200,000 characters) in under 2 seconds', (_name, text) => {
    const start = performance.now()
    redactSecrets(text)
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

// General shapes added after the blind corpus's dev half showed them missing (the examples here are
// this file's own, not the corpus's), and the `--flag value` rule, which the rewrite for the third
// audit dropped by mistake before the dev half caught it.
describe('redactSecrets: shapes added from the blind corpus\'s dev half', () => {
  const cases: Array<[string, string, string]> = [
    ['--password value', 'pg_dump --password S3cretPassw0rd -h db', 'S3cretPassw0rd'],
    ['--token value', `doppler run --token ${j('dp', '.st.', 'prd.', B62)} -- node app.js`, B62],
    ['--db-password value', 'deploy --db-password hunter22 --yes', 'hunter22'],
    ['--client-secret "value"', 'oauth2 --client-secret "Xy9kL2mN4pQ7rS1t" --id app', 'Xy9kL2mN4pQ7rS1t'],
    ['Authorization with an uncommon scheme', `Authorization: SSWS ${B62}`, B62],
    ['XML element', '<password>Tr0ub4dor&amp;3x</password>', 'Tr0ub4dor'],
    ['.NET appSettings', '<add key="StripeSecretKey" value="rT5uV6wX7yZ8aB9c" />', 'rT5uV6wX7yZ8aB9c'],
    ['SQL CREATE ROLE', "CREATE ROLE app WITH LOGIN PASSWORD 'Qw3rty!Uiop' VALID UNTIL 'infinity';", 'Qw3rty!Uiop'],
    ['SQL IDENTIFIED BY', "ALTER USER app IDENTIFIED BY 'Zx9Cv8Bn7';", 'Zx9Cv8Bn7'],
    ['credential constructor', 'new NetworkCredential("svc@example.com", "Pa55w0rd-2026")', 'Pa55w0rd-2026'],
    ['requests auth tuple', "requests.get(url, auth=('svc', 'Pa55w0rd-2026'))", 'Pa55w0rd-2026'],
    ['.netrc', 'machine api.example.com\n  login svc\n  password 9f8e7d6c-5b4a-3210', '9f8e7d6c-5b4a-3210'],
    ['.pgpass', 'db.internal:5432:*:replicator:Hk3%tR8#pL', 'Hk3%tR8#pL'],
    ['session cookie', 'Cookie: theme=dark; sessionid=Zq8Xw7Vu6Ts5Rq4P', 'Zq8Xw7Vu6Ts5Rq4P'],
    ['PHP and Java session cookies', 'Cookie: PHPSESSID=k2j3h4g5f6d7s8a9; JSESSIONID=Zq8Xw7Vu6Ts5Rq4P', 'k2j3h4g5f6d7s8a9'],
    ['Set-Cookie with attributes', 'Set-Cookie: _app_session_id=Zq8Xw7Vu6Ts5Rq4P; Path=/; HttpOnly; Secure', 'Zq8Xw7Vu6Ts5Rq4P'],
    ['OAuth authorization code', 'GET /callback?state=abc&code=4/0AfJohXn8Kz2mQ9vR7tY6uP5sW HTTP/1.1', '4/0AfJohXn8Kz2mQ9vR7tY6uP5sW'],
    ['base64-encoded PEM private key', `client-key-data: ${Buffer.from(`-----BEGIN EC PRIVATE KEY-----\n${B62}\n`).toString('base64')}`, Buffer.from(`-----BEGIN EC PRIVATE KEY-----\n${B62}\n`).toString('base64').slice(40, 60)],
    ['Vault older token', `vault login ${j('s', '.', 'x7U9k2PQqDyIYM1OoSJu2Dab')}`, 'x7U9k2PQqDyIYM1OoSJu2Dab'],
  ]
  it.each(cases)('%s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  const harmless = [
    'Cookie: _ga=GA1.1.445478328.1727164800; theme=dark; lang=en-GB',
    'resp = client.login(username=user, password=password)',
    'connect(password=self.password, host=self.host)',
    'GET /errors?code=404&page=2 HTTP/1.1',
    'the password must be at least 12 characters',
    '--token-file /run/secrets/token --verbose',
    '<username>ci-publisher</username>',
    'localhost:8080:ready',
  ]
  it.each(harmless)('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})
