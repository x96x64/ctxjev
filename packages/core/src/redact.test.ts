import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AUDIT3_FORMATS, AUDIT3_LINES, AUDIT4_HARMLESS, AUDIT5_HARMLESS, AUDIT5_LINES, B62, ENV_SWEEP, ENV_SWEEP_HALVES, FORMATS, HARMLESS, PW, j } from '../test/redactCases.js'
import { redactSecrets } from './redact.js'
import { describeGrowth, isLinear, measureGrowth } from '../../../test-support/linearTime.js'

/** `text(1)` and `text(10)` are the same input at a tenth of the size and at full size (see test-support/linearTime.ts). */
async function expectLinearRedaction(text: (k: number) => string) {
  const inputs = new Map([1, 10].map((k) => [k, text(k)]))
  const growth = await measureGrowth((k) => redactSecrets(inputs.get(k)!), 1, { warmUp: () => redactSecrets(inputs.get(1)!) })
  expect(isLinear(growth), describeGrowth(growth)).toBe(true)
}

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
// line could hold up a hook. The check is the growth from n to 10n: linear against quadratic, not speed.
describe('redactSecrets: time grows linearly on long runs', () => {
  // How the time grows from 20,000 to 200,000 characters (see test-support/linearTime.ts), not a
  // wall-clock limit, which a slow machine or coverage instrumentation could fail.
  const runs: Array<[string, (n: number) => string]> = [
    ['a.a.a…', (n) => 'a.'.repeat(n / 2)],
    ['a-a-a…', (n) => 'a-'.repeat(n / 2)],
    ['a:a:a…', (n) => 'a:'.repeat(n / 2)],
    ['x:tokenx:…', (n) => 'x:tokenx:'.repeat(n / 9)],
    ['Error: …', (n) => 'Error: '.repeat(n / 7)],
    ['a://b:…', (n) => 'a://b:'.repeat(n / 6)],
    ['mysql …', (n) => 'mysql '.repeat(n / 6)],
    ['"a": "…', (n) => '"a": "'.repeat(n / 6)],
    ['█…', (n) => '█'.repeat(n)],
    ['.netrc password lines…', (n) => `machine h\n${'password x\n'.repeat(n / 11)}`],
    ['Cookie: a=b; …', (n) => `Cookie: ${'a=b; '.repeat(n / 5)}`],
    ['.pgpass lines…', (n) => 'h:5432:d:u:p\n'.repeat(n / 13)],
    [' --token …', (n) => ' --token '.repeat(n / 9)],
    // The rule for a value that ends its line (the fourth audit's P0-1).
    ['a=a=a…', (n) => 'a='.repeat(n / 2)],
    ['a=a=a… x', (n) => `${'a='.repeat(n / 2)} x`],
    ['password=)))…', (n) => `password=${')'.repeat(n)}`],
    ['password=,,,…', (n) => `password=${','.repeat(n)}`],
    ['x=y, spaces, z', (n) => `x=y${' '.repeat(n)}z`],
    ['Environment=Environment=…', (n) => `${'Environment='.repeat(n / 12)}DB_PASSWORD=x(y`],
    ['a: a: a: …', (n) => 'a: '.repeat(n / 3)],
    ['token=${${${…', (n) => `token=${'${'.repeat(n / 2)}`],
    ['token: 1.0 1.0 … x', (n) => `token: ${'1.0 '.repeat(n / 4)}x`],
    ['.env lines…', (n) => 'DB_PASSWORD=Qx7(pL9\n'.repeat(n / 20)],
    // The review of the change: each ` #` read the rest of the line again.
    ['password=b # …', (n) => 'password=b # '.repeat(n / 13)],
    ['a=b # …', (n) => 'a=b # '.repeat(n / 6)],
    ['a: b\t#\t…', (n) => 'a: b\t#\t'.repeat(n / 7)],
    // The fifth audit's rules: a URL password up to its last `@`, a passphrase, a Japanese label's value.
    ['a://b:c#…', (n) => 'a://b:c#'.repeat(n / 8)],
    ['a://b:#@c/…', (n) => 'a://b:#@c/'.repeat(n / 10)],
    ['a://b:#@a@a…', (n) => `a://b:#${'@a'.repeat(n / 2)}`],
    ['a://b:#@a.a.a…', (n) => `a://b:#@${'a.'.repeat(n / 2)}`],
    ['"a://b:#…', (n) => '"a://b:#'.repeat(n / 8)],
    ['password=a b lines…', (n) => 'password=a b\n'.repeat(n / 13)],
    ['password=a a a…', (n) => `password=${'a '.repeat(n / 2)}`],
    ['password: a b # # …', (n) => `password: a b${' #'.repeat(n / 2)}`],
    ['export export …', (n) => `${'export '.repeat(n / 7)}PASSWORD=a b`],
    ['パスワード: パスワード: …', (n) => 'パスワード: '.repeat(n / 7)],
    ['パスワード:a1b2…', (n) => 'パスワード:a1b2'.repeat(n / 10)],
    ['トークン=あああ…', (n) => `トークン=${'あ'.repeat(n)}`],
    [' --password "…', (n) => ' --password "'.repeat(n / 13)],
    [' --password "a b…', (n) => ' --password "a b'.repeat(n / 16)],
    // Round 5's shapes from its blind corpus: typed declarations, redis, labels in other languages.
    ['x: y x: y …', (n) => 'x: y '.repeat(n / 5)],
    ['password: str = "…', (n) => 'password: str = "'.repeat(n / 17)],
    ['"AUTH" "…', (n) => '"AUTH" "'.repeat(n / 8)],
    ['> AUTH …', (n) => '> AUTH '.repeat(n / 7)],
    ['requirepass lines…', (n) => 'requirepass a\n'.repeat(n / 14)],
    ['密码：密码：…', (n) => '密码：'.repeat(n / 3)],
    ['mot de passe : …', (n) => 'mot de passe : '.repeat(n / 15)],
    ['ssh-keygen -P …', (n) => 'ssh-keygen -P '.repeat(n / 14)],
    ['7z -p7z -p…', (n) => '7z -p'.repeat(n / 5)],
    // The review of Round 5's change: a user name with `@`, a command after a run of spaces.
    ['a://b@c:…', (n) => 'a://b@c:'.repeat(n / 8)],
    ['a://@:@a…', (n) => `a://@:${'@a'.repeat(n / 2)}`],
    ['spaces, then zip -P', (n) => `${' '.repeat(n)}zip -P x`],
    ['; ; ; zip…', (n) => '; zip '.repeat(n / 6)],
    ['h:1> AUTH …', (n) => 'h:1> AUTH '.repeat(n / 10)],
    // The re-review: a labelled value is read to its end, however long.
    ['パスワード: a(a(…', (n) => `パスワード: ${'a('.repeat(n / 2)}`],
    ['密码：xxx…', (n) => `密码：${'x1'.repeat(n / 2)}`],
    ['トークン: a1 トークン: a1 …', (n) => 'トークン: a1 '.repeat(n / 10)],
    ['zip -9 -9 …', (n) => `zip ${'-9 '.repeat(n / 3)}-P x`],
  ]
  it.each(runs)('%s: 20,000 characters against 200,000', async (_name, text) => {
    const inputs = new Map([20_000, 200_000].map((n) => [n, text(n)]))
    const growth = await measureGrowth((n) => redactSecrets(inputs.get(n)!), 20_000, { warmUp: () => redactSecrets(inputs.get(20_000)!) })
    expect(isLinear(growth), describeGrowth(growth)).toBe(true)
  }, 60_000)
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

// PR #15's independent review: shapes 0.6.1 masked and the first version of this change didn't
// (cookies outside a bare `Cookie:` header, `mysql -p` and `curl -u` far along a long command, a
// short `--token`), shapes neither masked, and ordinary text the new rules masked.
describe('redactSecrets: the independent review of the masking change', () => {
  const longMysql = `mysql --host=prod-db.cluster-c9akciq32.eu-west-1.rds.amazonaws.com --port=3306 --ssl-ca=/etc/ssl/certs/rds-combined-ca-bundle.pem --ssl-mode=VERIFY_IDENTITY --default-character-set=utf8mb4 --database=app --user=admin -pS3cretPassw0rd`
  const longCurl = `curl -X POST https://api.example.com/v1/import -H 'Content-Type: application/json' -d '${JSON.stringify({ items: Array.from({ length: 12 }, (_, i) => ({ id: i, name: `item-${i}`, tags: ['a', 'b'] })) })}' -u admin:S3cretPassw0rd`
  const regressions: Array<[string, string, string]> = [
    ['Cookie in a JSON header object', '{"Cookie": "sessionid=Zq8Xw7Vu6Ts5Rq4Pab"}', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['Cookie in a Python requests dict', "headers={'Cookie': 'sessionid=Zq8Xw7Vu6Ts5Rq4Pab'}", 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['Cookie in escaped JSON', '{\\"Cookie\\": \\"sessionid=Zq8Xw7Vu6Ts5Rq4Pab\\"}', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['document.cookie', 'document.cookie = "sid=Zq8Xw7Vu6Ts5Rq4Pab"', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['AUTH_COOKIE', 'AUTH_COOKIE=Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['SESSION_COOKIE', 'SESSION_COOKIE=Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['WordPress login cookie', 'Cookie: wordpress_logged_in_5c3a1f=admin%7C1727164800%7CZq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['Drupal session cookie', 'Cookie: SSESS4f2a9c1e7b3d5a8c=Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['mysql -p on a long command', longMysql, 'S3cretPassw0rd'],
    ['curl -u on a long command', longCurl, 'S3cretPassw0rd'],
    ['--token with a short value', 'app --token abc123', 'abc123'],
    ['--api-key with a numeric value', 'app --api-key 12345678901234', '12345678901234'],
  ]
  it.each(regressions)('masks, as 0.6.1 did: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  const missed: Array<[string, string, string]> = [
    ['a URL password with no user name', 'REDIS_URL=redis://:Zq8Xw7Vu6Ts5Rq4P@cache:6379/0', 'Zq8Xw7Vu6Ts5Rq4P'],
    ['a Kubernetes env var over two lines', 'env:\n  - name: DB_PASSWORD\n    value: "Hk3tR8pLq2Zx"', 'Hk3tR8pLq2Zx'],
    ['curl -u with no space', 'curl -uadmin:S3cretPassw0rd https://api.example.com', 'S3cretPassw0rd'],
    ['az login -p', 'az login --service-principal -u http://app -p Zq8Xw7Vu6Ts5Rq4P --tenant contoso', 'Zq8Xw7Vu6Ts5Rq4P'],
    ['sqlcmd -P', 'sqlcmd -S db.internal -U sa -P Zq8Xw7Vu6Ts5Rq4P -Q "SELECT 1"', 'Zq8Xw7Vu6Ts5Rq4P'],
    ['a SigV4 signature in an Authorization header', `Authorization: AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260925/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=${'5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7'}`, '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7'],
    ['a .netrc default entry', 'machine api.example.com login svc password Zq8Xw7Vu6Ts5Rq4P\ndefault login anonymous password Hk3tR8pLq2Zx', 'Hk3tR8pLq2Zx'],
  ]
  it.each(missed)('masks: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  const harmless = [
    '12:30:45:123:4567',
    'config.yml:3:image:node:20',
    'state machine enters login\npassword prompt shown twice',
    'print("Enter password " + user + "")',
    'the password "is too short"',
    'docker login ghcr.io && docker run -p 8080:80 app',
    'GET /download?key=reports/2026/q3.csv HTTP/1.1',
    '<Token>Identifier</Token>',
    'Authorization: missing credentials',
    'const STORAGE_KEY = "todos-v1"',
    'httpie --auth basic',
    'Cookie: a small file the browser keeps',
    'COOKIE_NAME=sessionid',
  ]
  it.each(harmless)('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})

// The second independent review, of the first fix: a command was cut at a `;` or `|` inside quotes,
// the cut points were reused after an earlier command's password had been masked (moving the text),
// and more ways to write a cookie header. Most of these were masked by 0.6.1; the rest (sshpass,
// redis-cli, docker, a CRLF continuation, and the XML, SAS, pgpass, and SQL shapes) weren't.
describe('redactSecrets: the second review of the masking change', () => {
  const pw = 'S3cr3tPw9xQ'
  const leaks: Array<[string, string, string]> = [
    ['curl with a quoted header holding ";"', `curl -H "Content-Type: application/json; charset=utf-8" -u admin:${pw} https://api.example.com`, pw],
    ['curl with a quoted Cookie header', `curl -H 'Cookie: a=1; b=2' -u admin:${pw} https://x`, pw],
    ['curl --user after a quoted ";"', `curl -H "Accept: text/html;q=0.9" --user admin:${pw} https://x`, pw],
    ['curl -d with ";" before -u', `curl -s https://x -d 'a=1;b=2' -u admin:${pw}`, pw],
    ['mysql -e with ";" before -p', `mysql -u root -e "USE app; SELECT * FROM users;" -p${pw}`, pw],
    ['mysql -e "SHOW TABLES;" -uroot -p', `mysql -h db -e "SHOW TABLES;" -uroot -p${pw}`, pw],
    ['a quoted mysql password with ";"', "mysql -u root -p'Xy7;kPq9' db", 'kPq9'],
    ['a quoted mysql password with "|"', "mysql -u root -p'Xy7|kPq9' db", 'kPq9'],
    ['a quoted mysql password with "&&"', 'mysql -u root -p"Xy7&&kPq9" db', 'kPq9'],
    ['a quoted curl user:password with ";"', "curl -u 'admin:Xy7;kPq9' https://x", 'kPq9'],
    ['a quoted sshpass password with ";"', "sshpass -p 'Xy7;kPq9' ssh u@h", 'kPq9'],
    ['a quoted redis-cli password with ";"', "redis-cli -a 'Xy7;kPq9' ping", 'kPq9'],
    ['a quoted docker login password with "|"', "docker login -u me -p 'Xy7|kPq9' registry", 'kPq9'],
    ['curl after mysql on the next line', 'mysql -u root -pMyDbPassw0rd2024xyz db\ncurl -u admin:CurlPassw0rd99 https://x', 'CurlPassw0rd99'],
    ['curl after mysql and "; "', 'mysql -u root -pMyDbPassw0rd2024xyz db; curl -u admin:CurlPassw0rd99 https://x', 'CurlPassw0rd99'],
    ['curl after a short mysql password', 'mysql -u root -pabc db\ncurl -u admin:CurlPassw0rd99\necho done', 'sw0rd99'],
    ['sshpass after mysqldump', 'mysqldump -u root -pP4ssw0rdThatIsLong db > x.sql\nsshpass -p Sshp4ssw0rd ssh u@h', 'Sshp4ssw0rd'],
    ['redis-cli after mysql', 'mysql -u root -pP4ssw0rdThatIsLong db\nredis-cli -a R3disPassw0rd ping', 'R3disPassw0rd'],
    ['sshpass after a long curl password', 'curl -u admin:CurlPassw0rd99LongLongLong https://x\nsshpass -p Sshp4ssw0rd ssh u@h', '4ssw0rd'],
    ['a continued mysql command with CRLF', `mysql \\\r\n  -u admin \\\r\n  -p${pw} db`, pw],
    ["PHP's => header", "'headers' => ['Cookie' => 'sessionid=Zq8Xw7Vu6Ts5Rq4Pab']", 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ["Ruby's => header", '{"Cookie" => "sessionid=Zq8Xw7Vu6Ts5Rq4Pab"}', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ["Perl's => header", `$ua->default_header('Cookie' => "sessionid=Zq8Xw7Vu6Ts5Rq4Pab")`, 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ["Go's :=", 'Cookie := "sessionid=Zq8Xw7Vu6Ts5Rq4Pab"', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a second cookie header in minified JSON', '{"cookie":"theme=dark","set-cookie":"sessionid=Zq8Xw7Vu6Ts5Rq4Pab; Path=/"}', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a second Cookie object on the line', '[{"Cookie": "_ga=GA1.2"}, {"Cookie": "sessionid=Zq8Xw7Vu6Ts5Rq4Pab"}]', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['document.cookie with a template literal', 'document.cookie = `sid=Zq8Xw7Vu6Ts5Rq4Pab`', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a cookie value after an escaped quote', '"Cookie": "a=b\\"c; sessionid=Zq8Xw7Vu6Ts5Rq4Pab"', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a quoted cookie value', 'Cookie: sessionid="Zq8Xw7Vu6Ts5Rq4Pab"', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a quoted Set-Cookie value', 'Set-Cookie: sessionid="Zq8Xw7Vu6Ts5Rq4Pab"; Path=/', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['Authorization with the Bot scheme', 'Authorization: Bot abcdefghijklmnop', 'abcdefghijklmnop'],
    ['Authorization with no scheme', 'Authorization: abcdefghijklmnop', 'abcdefghijklmnop'],
    ['a short --token', 'app --token abcdef', 'abcdef'],
    ['a short --client-secret', 'app --client-secret abcdefg', 'abcdefg'],
    ['an XML ApiKey of letters', '<ApiKey>abcdefghijklmnop</ApiKey>', 'abcdefghijklmnop'],
    ['an XML clientSecret of letters', '<clientSecret>mysecretvalue</clientSecret>', 'mysecretvalue'],
    ['a .NET ApiKey of letters', '<add key="ApiKey" value="abcdefghij"/>', 'abcdefghij'],
    ['an XML secret with spaces', '<secret>correct horse battery</secret>', 'correct horse battery'],
    ['a SAS signature with a slash', 'https://acct.blob.core.windows.net/c/b?sv=2024&sig=AbCd/EfGh+IjKlMn0pQr=', 'AbCd/EfGh+IjKlMn0pQr='],
    ['a key with a version suffix', 'https://api.example.com/v1?key=abcd1234efgh5678.v2', 'abcd1234efgh5678'],
    ['a session id with a dot', 'https://app.example.com/?sessionid=abc123def.xyz', 'abc123def'],
    ['a numeric pgpass password', 'db:5432:app:app:12345678', '12345678'],
    ['a pgpass socket directory', '/var/run/postgresql:5432:app:app:Hk3tR8pLq2Zx', 'Hk3tR8pLq2Zx'],
    ['a .netrc password before a comment', 'machine api.example.com login svc password Hk3tR8pLq2Zx # prod', 'Hk3tR8pLq2Zx'],
    ['SQL PASSWORD with spaces', "CREATE ROLE app WITH LOGIN PASSWORD 'correct horse battery staple';", 'correct horse battery staple'],
  ]
  it.each(leaks)('masks: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  it('leaves a later command\'s port mapping alone after masking earlier passwords', () => {
    const masked = redactSecrets('mysql -pa\nmysql -pb\nmysql -pc\ndocker login ghcr.io && docker run -p 8080:80 img')
    expect(masked).toBe('mysql -p[REDACTED]\nmysql -p[REDACTED]\nmysql -p[REDACTED]\ndocker login ghcr.io && docker run -p 8080:80 img')
  })

  const harmless = [
    'env:\n  - name: AUTH\n    value: disabled',
    'env:\n  - name: SESSION_COOKIE\n    value: sessionid',
    'REDIS_URL=redis://:@cache:6379',
    'httpie --auth basic https://x',
  ]
  it.each(harmless)('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})

// Gaps the second review found in every version so far: an Authorization header written as data.
describe('redactSecrets: an Authorization header written as data', () => {
  const cases: Array<[string, string]> = [
    ['{"Authorization": "Basic dXNlcjpwYXNzd29yZA=="}', 'dXNlcjpwYXNzd29yZA=='],
    ["headers={'Authorization': 'Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b'}", '9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b'],
    ["'Authorization' => 'Bearer abcdefghijklmnopqrstuvwx'", 'abcdefghijklmnopqrstuvwx'],
  ]
  it.each(cases)('masks %s', (text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })
})

describe('redactSecrets: the second review — cookie names that don\'t say what they hold', () => {
  const cases: Array<[string, string]> = [
    ['COOKIE=Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['MY_COOKIE=Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['COOKIE_VALUE=Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['Cookie: Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['"Cookie": "Zq8Xw7Vu6Ts5Rq4Pab"', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['Cookie: user=Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['Cookie: _ga=GA1.1.445478328.1727164800; id=Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['cookie=sessionid%3DZq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['curl -u admin:Xy7;kPq9 https://x', 'kPq9'],
    ['machine h\n# prod\nlogin u\npassword Hk3tR8pLq2Zx', 'Hk3tR8pLq2Zx'],
    ['machine h login u password Hk3tR8pLq2Zx port 22', 'Hk3tR8pLq2Zx'],
    ['machine h login u password "Hk3t R8pLq2Zx"', 'R8pLq2Zx'],
  ]
  it.each(cases)('masks %s', (text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  const harmless = [
    'Set-Cookie: sessionid=[REDACTED]; Path=/; Domain=subdomain.example.com; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
    'const cookie = req.headers.cookie',
    'COOKIE_NAME=sessionid',
    '10.0.0.1:5432:postgres:postgres:*',
  ]
  it.each(harmless)('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})

// The third independent review: close variants of the second review's findings that still leaked
// what 0.6.1 masked, and a regular expression that took exponential time.
describe('redactSecrets: the third review of the masking change', () => {
  const pw = 'S3cr3tPw9xQ'
  const leaks: Array<[string, string, string]> = [
    ['an apostrophe earlier on the line, then mysql -e with ";"', `Let's check: mysql -u root -e 'SHOW DATABASES; SELECT 1' -p${pw}`, pw],
    ['an apostrophe earlier on the line, then curl -H with ";"', `Here's the call: curl -H 'Accept: text/html; q=0.9' -u admin:${pw} https://x`, pw],
    ['an apostrophe earlier on the line, then a quoted password', "Don't worry: mysql -u root -p'Xy7;kPq9' db", 'kPq9'],
    ["an apostrophe in mysql's own arguments", `mysql -u o'brien -e 'USE a; SELECT 1' -p${pw}`, pw],
    ['an apostrophe, then a quoted curl user:password', "it's: curl -u 'admin:Xy7;kPq9' https://x", 'Xy7'],
    ['--api_key', 'python run.py --api_key Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['--client_secret', 'python run.py --client_secret Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['--API_KEY', 'tool --API_KEY Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a scheme-less token and more words after it', 'level=info authorization=a1b2c3d4e5f6g7h8i9j0 path=/v1/users status=200', 'a1b2c3d4e5f6g7h8i9j0'],
    ['a scheme-less token, then a word', 'Authorization: a1b2c3d4e5f6g7h8i9j0 rejected', 'a1b2c3d4e5f6g7h8i9j0'],
    ['a scheme-less token, then HTTP/1.1', 'Authorization: a1b2c3d4e5f6g7h8i9j0 HTTP/1.1', 'a1b2c3d4e5f6g7h8i9j0'],
    ['two -H Cookie headers', `curl -H "Cookie: theme=dark" -H "Cookie: sessionid=Zq8Xw7Vu6Ts5Rq4Pab" https://x`, 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ["two -H Cookie headers in single quotes", `curl -H 'Cookie: theme=dark' -H 'Cookie: sessionid=Zq8Xw7Vu6Ts5Rq4Pab' https://x`, 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['two Set-Cookie headers on a line', 'Set-Cookie: theme=dark; Path=/ Set-Cookie: sessionid=Zq8Xw7Vu6Ts5Rq4Pab; Path=/', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a cookie list under MY_COOKIE', 'MY_COOKIE="sessionid=Zq8Xw7Vu6Ts5Rq4Pab"', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a cookie list under rawCookie', 'const rawCookie = "sid=Zq8Xw7Vu6Ts5Rq4Pab"', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a cookie list under CURL_COOKIE', 'CURL_COOKIE=sessionid=Zq8Xw7Vu6Ts5Rq4Pab', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a cookie list under req_cookie', 'req_cookie: "sessionid=Zq8Xw7Vu6Ts5Rq4Pab"', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['a base64 token after Cookie:', 'Cookie: dGhpcyBpcyBhIHNlc3Npb24gdG9rZW4=', 'dGhpcyBpcyBhIHNlc3Npb24gdG9rZW4'],
    ['a base64 token in COOKIE=', 'COOKIE=dGhpcyBpcyBhIHNlc3Npb24gdG9rZW4=', 'dGhpcyBpcyBhIHNlc3Npb24gdG9rZW4'],
    ['a base64 token in export COOKIE="…"', 'export COOKIE="dGhpcyBpcyBhIHNlc3Npb24gdG9rZW4="', 'dGhpcyBpcyBhIHNlc3Npb24gdG9rZW4'],
    ['a short token cookie', 'Cookie: uid=a8f3k2m9x1', 'a8f3k2m9x1'],
    ['a short token cookie as data', '"Cookie": "uid=a8f3k2m9x1"', 'a8f3k2m9x1'],
    ['a password-like cookie', 'Cookie: user=S3cr3tPw9xQ', 'S3cr3tPw9xQ'],
    ['a cookie before a plain one', 'Cookie: SSID=AbCdEf1234; theme=dark', 'AbCdEf1234'],
    ['a JSON-escaped slash in a cookie', '{"Cookie":"sessionid=Zq8Xw7\\/Vu6Ts5Rq4Pab"}', 'Vu6Ts5Rq4Pab'],
    ['a JSON-escaped slash later in a cookie', '{"Cookie":"sessionid=Zq8Xw7Vu\\/6Ts5Rq4Pab"}', '6Ts5Rq4Pab'],
  ]
  it.each(leaks)('masks: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  const harmless = [
    'Set-Cookie: a=b; SameSite=Lax; HttpOnly',
    'Cookie: theme=dark; lang=en-GB',
    'const cookie = req.headers.cookie',
    'const cookie = getCookieValue()',
    'docker login ghcr.io && docker run -p 8080:80 img',
  ]
  it.each(harmless)('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })

  // A bash header with CRLF line ends and a block of comments: NETRC_HINT's comment-line group was
  // ambiguous about the trailing whitespace, and 30 lines took 30 seconds.
  it('takes linear time on comment blocks with trailing whitespace', async () => {
    const texts = (k: number) => [
      '#!/bin/bash\r\n#   --mode MODE   release or debug; release is the default\r\n' + '#   more help text here\r\n'.repeat(200 * k),
      'use the default\r\n' + '# comment\r\n'.repeat(500 * k),
      'machine example.com\n' + '# comment \n'.repeat(500 * k) + 'login u\npassword Hk3tR8pLq2Zx',
    ]
    for (let i = 0; i < texts(1).length; i++) await expectLinearRedaction((k) => texts(k)[i])
    expect(redactSecrets(texts(10)[2])).not.toContain('Hk3tR8pLq2Zx')
  }, 120_000)
})

describe('redactSecrets: the third review, found by its fuzzers', () => {
  const cases: Array<[string, string]> = [
    ['MY_COOKIE=Zq8/Xw7+Vu6Ts5Rq4Pab==', 'Zq8/Xw7+Vu6Ts5Rq4Pab'],
    ['--token curl -u admin:Q3flivtx7Z2k8g2f https://x', 'Q3flivtx7Z2k8g2f'],
    ['--token mysql -u root -pQf7ngh1x7Z3k5amk db', 'Qf7ngh1x7Z3k5amk'],
    ['authorization=a1b2c3d4e5f6g7h8i9j0 Authorization: b1b2c3d4e5f6g7h8i9j0', 'b1b2c3d4e5f6g7h8i9j0'],
    ['Cookie: sessionid=abc1234', 'abc1234'],
    ['"Cookie": "sessionid=abc1234"', 'abc1234'],
    ['MY_COOKIE=Zq8/Xw7+Vu6Ts5Rq4Pab==.', 'Zq8/Xw7+Vu6Ts5Rq4Pab'],
    ['--token "Cookie": "sessionid=Q7dk51cx7Z1khxvw"', 'Q7dk51cx7Z1khxvw'],
    ['(Cookie: theme=dark; sessionid=Zq8Xw7Vu6Ts5Rq4Pab)', 'Zq8Xw7Vu6Ts5Rq4Pab'],
    ['password "password": "Q1pp8oux7Z0kh9bj"', 'Q1pp8oux7Z0kh9bj'],
    ['--token "password": "Q1pp8oux7Z0kh9bj"', 'Q1pp8oux7Z0kh9bj'],
  ]
  it.each(cases)('masks %s', (text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })
})

// The fourth independent review: leaks of what 0.6.1 masked, a quadratic rule, and outputs that
// changed when masked again. 0.6.1's rules now run first (redactLegacy.ts), and masking repeats
// until nothing changes.
describe('redactSecrets: the fourth review of the masking change', () => {
  const leaks: Array<[string, string, string]> = [
    ['a Jetty session id', 'Cookie: JSESSIONID=node01e2jb8d3u5y0x1ro8pvfqg3rn0.node0', 'node01e2jb8d3u5y0x1ro8pvfqg3rn0'],
    ['a Flask session cookie', 'Set-Cookie: session=eyJfZnJlc2giOmZhbHNlfQ.ZQ8xYw.Tj3kM9wQ1_xYz0AbCdEfGhIjKlM; HttpOnly; Path=/', 'Tj3kM9wQ1_xYz0AbCdEfGhIjKlM'],
    ['a session id that looks like a placeholder', 'Cookie: sessionid=$ecret9Zq', '$ecret9Zq'],
    ['two authorization= on a line', 'authorization=a1b2c3d4e5f6 authorization=Zx4Cv6Bn8Mk2', 'Zx4Cv6Bn8Mk2'],
    ['two Authorization headers, the second with no space', 'Authorization: a1b2c3d4e5f6 Authorization:Zx4Cv6Bn8Mk2', 'Zx4Cv6Bn8Mk2'],
    ['a flag after an Authorization label', 'Error: no Authorization: use --api-key S3cretKey99 instead', 'S3cretKey99'],
    ['a password with the command name in it', "mysql -u root -p'mysql' db", "'mysql'"],
    ['a password with @mysql in it', 'mysql -uroot -p"root@mysql"', 'root@'],
    ['a dotted password with mysql in it', 'mysql -u root -pMy.mysql.pw db', 'mysql.pw'],
    ['a curl password with curl in it', "curl -u 'svc:p@ss-curl-2024' https://x", 'p@ss'],
    ['an unterminated quote', 'curl -u "admin:S3cret https://x', 'S3cret'],
    ['a label after a cookie', 'Cookie: sid=1; DB_PASSWORD: hunter22', 'hunter22'],
    ['an API key header after a cookie', 'Cookie: sid=1; X-Api-Key: S3cretKey99', 'S3cretKey99'],
    ['a --password after a cookie', 'Cookie: sid=1; --password Pa55word99', 'Pa55word99'],
    ['a flag value that looks like a placeholder', 'tool --password %Pa55word', '%Pa55word'],
    ['a flag value starting with $', 'tool --token $ecret9Zq', '$ecret9Zq'],
    ['a flag value before " :"', 'tool --token abcdef :x', 'abcdef'],
    ['PASSWORD= inside a quoted value', 'x:password="a PASSWORD="S3cret99"', 'S3cret99'],
    ['deeply nested labels', 'a:b:c:d:e:f:g:h:i:"x PASSWORD=secret1"', 'secret1'],
    ['a query after a secret', 'secret=Qw7Er9Ty3Ui5?key=PASSWORD ', 'Qw7Er9Ty3Ui5'],
  ]
  it.each(leaks)('masks: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  it.each(['?key=password:/', 'password := hunter22', 'authorization=a1b2c3d4e5f6 authorization=Zx4Cv6Bn8Mk2'])('is the same when masked again: %s', (text) => {
    const masked = redactSecrets(text)
    expect(redactSecrets(masked)).toBe(masked)
  })

  it('takes linear time on joined Authorization labels', async () => {
    for (const unit of ['Authorization=', 'Proxy-Authorization=']) await expectLinearRedaction((k) => unit.repeat(Math.ceil((30_000 * k) / unit.length)) + ': ')
  }, 60_000)
})

describe('redactSecrets: a cookie token followed by prose', () => {
  it.each([
    ['Cookie: dGhpcyBpcyBhIHNlc3Npb24gdG9rZW4= and more text', 'dGhpcyBpcyBhIHNlc3Npb24gdG9rZW4'],
    ['Cookie: TOKEN123abcdef was rejected', 'TOKEN123abcdef'],
  ])('masks %s', (text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })
})

describe('redactSecrets: 0.6.1\'s rules, run first (redactLegacy.ts)', () => {
  it.each([
    ['curl -u followed by a run of "="', (k: number) => 'curl -u' + '='.repeat(30_000 * k)],
    ['mysql mentioned over and over with no -p', (k: number) => 'mysql '.repeat(5_000 * k)],
    ['curl mentioned over and over on one line', (k: number) => 'curl -H x '.repeat(3_000 * k) + '-u admin:S3cretPw9xQ'],
  ])('takes linear time: %s', async (_name, text) => expectLinearRedaction(text), 60_000)

  it('masks what 0.6.1 masked, 0.6.1\'s own cases included', () => {
    expect(redactSecrets('mysql -u root -pS3cretPw9xQ db')).not.toContain('S3cretPw9xQ')
    expect(redactSecrets('curl -u admin:S3cretPw9xQ https://x')).not.toContain('S3cretPw9xQ')
    expect(redactSecrets('Authorization: Bot abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
    expect(redactSecrets('tool --token $ecret9Zq')).not.toContain('$ecret9Zq')
  })

  it.each([
    // With a word before it, so 0.6.1's rule (which wants whitespace before `--`) would mask it.
    ['psql --password <password>   password for the database user', 'psql --password <password>   password for the database user'],
    ['password=password', 'password=password'],
  ])('leaves alone what it decides differently from 0.6.1: %s', (text, expected) => {
    expect(redactSecrets(text)).toBe(expected)
  })

  it('doesn\'t take a header\'s name for the value of a Japanese label', () => {
    expect(redactSecrets('パスワード: Set-Cookie: sid=Qw7Er9Ty3Ui5; Path=/')).not.toContain('Qw7Er9Ty3Ui5')
  })
})

// The fifth independent review, of the legacy-first design.
describe('redactSecrets: the fifth review of the masking change', () => {
  it.each([
    ['a URL password over 1,024 characters (0.6.1 masked it)', `https://user:${'p'.repeat(1100)}@host/x`, 'p'.repeat(40)],
    ['a URL user name over 256 characters (0.6.1 masked the password)', `https://${'u'.repeat(300)}:hunter22secret@host/x`, 'hunter22secret'],
    ['a curl user name over 256 characters (0.6.1 masked the password)', `curl -u ${'u'.repeat(300)}:hunter22secret https://x`, 'hunter22secret'],
    ['a flag value before " :"', 'deploy --db-password hunter22 :x', 'hunter22'],
    ['a flag value before " :", named like a cookie', 'x --session-cookie sid=abc123XYZ :z', 'abc123XYZ'],
    ['a flag value before " :", its last character', 'deploy --db-password hunter22 :x', '2 :x'],
    ['a Japanese label and a password ending in ":"', 'パスワード: Hunter22:', 'Hunter22'],
    ['a Bearer token after a card number, after a query', '?sig=@4111111111111111Bearer svj1kRt8RSiETjP8wheD', 'svj1kRt8RSiETjP8wheD'],
    ['a token on the line after a card number in a cookie', 'Cookie: =4111111111111111Bearer\nZk3fQ2mPzR8vXw1yT4bN', 'Zk3fQ2mPzR8vXw1yT4bN'],
  ])('masks: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  // Card numbers and keys glued together with nothing between them: each mask can make the next one
  // recognizable, one step per pass. Four passes cover a few; longer chains are a known limit.
  it('is the same when masked again with a few card numbers and keys glued together', () => {
    const link = (i: number) => `4111111111111111${j('AIza', `SyD00${i}kQ9vX2mPzR8vXw1yT4bN5cL6dFgH-`)}`
    const text = [0, 1, 2, 3].map(link).join('') + '4111111111111111'
    const masked = redactSecrets(text)
    expect(masked).not.toContain('4111111111111111')
    expect(redactSecrets(masked)).toBe(masked)
  })
})

// The sixth independent review.
describe('redactSecrets: the sixth review of the masking change', () => {
  it.each([
    ['a Japanese-label value that only ends in a header name', 'パスワード:hunter22;Cookie:', 'hunter22'],
    ['the same after an sshpass password', 'sshpass -p pw,パスワード: S3cretPw;Set-Cookie:', 'S3cretPw'],
    ['the same after a curl password', 'curl -u :pw,パスワード: S3cretPw;Set-Cookie: sid=abc', 'S3cretPw'],
    ['the same after a query signature', 'https://h/cb?sig=abcdefghパスワード: S3cretPw;Authorization:', 'S3cretPw'],
    ['the same after a flag', 'deploy --db-password xパスワード: S3cretPw;Cookie:', 'S3cretPw'],
    ['a same-name value in another case', 'password=Password', 'Password'],
  ])('masks: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  it('masks a JWT as 0.6.1 did, including one glued after "-" or "_"', () => {
    const jwt = j('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')
    for (const text of [jwt, `token-${jwt}`, `gsk_${jwt}`, `a-eyJ-${jwt}`, `Authorization: ${jwt}`]) expect(redactSecrets(text)).not.toContain('dozjgNryP4J3jVmNHl0w5N')
    expect(redactSecrets(`${'eyJabcdefgh'}.x.y`)).toBe('eyJabcdefgh.x.y')
  })

  // 0.6.1's JWT rule restarted at every "eyJ" after "-" or "_" and read to the end of the run:
  // 200,000 characters of "-eyJ" took 47 seconds. The URL rule's scheme was unbounded in 0.6.1 too.
  it.each([
    ['-eyJ repeated', (k: number) => '-eyJ'.repeat(7_500 * k)],
    ['x-eyJ0-x-eyJ1-… repeated', (k: number) => Array.from({ length: 3_000 * k }, (_, i) => `x-eyJ${i}-`).join('')],
    ['_eyJ repeated', (k: number) => '_eyJ'.repeat(7_500 * k)],
    ['a. repeated before ://', (k: number) => 'a.'.repeat(15_000 * k) + '://'],
  ])('takes linear time: %s', async (_name, text) => expectLinearRedaction(text), 60_000)
})

// Formats the CHANGELOG lists that had no test of their own (the sixth review). Built at run time,
// so no provider-shaped string sits in the repository.
describe('redactSecrets: formats named in the CHANGELOG', () => {
  const hex = (n: number) => '0123456789abcdef'.repeat(Math.ceil(n / 16)).slice(0, n)
  const up = (n: number) => 'A1B2C3D4E5F6G7H8J9K0L1M2N3P4Q5R6'.repeat(3).slice(0, n)
  const cases: Array<[string, string]> = [
    ['Mailchimp', j(hex(32), '-us', '14')],
    ['Postman', j('PMAK', '-', hex(24), '-', hex(34))],
    ['New Relic', j('NR', 'AK', '-', up(27))],
    ['Databricks', j('dapi', hex(32))],
    ['Square', j('sq0', 'atp', '-', B62.slice(0, 22))],
    ['Terraform Cloud', j(B62.slice(0, 14), '.atlas', 'v1.', B62, B62.slice(0, 22))],
    ['Atlassian', j('ATATT', '3', B62)],
    ['Docker Hub', j('dckr', '_pat_', B62.slice(0, 24))],
    ['Sentry auth token', j('sntry', 'u_', B62, B62.slice(0, 4))],
    ['Slack app token', j('xapp', '-1-', B62.slice(0, 20))],
    ['Google OAuth client secret', j('GOCSPX', '-', B62.slice(0, 24))],
    ['GitLab deploy token', j('gldt', '-', B62.slice(0, 20))],
  ]
  it.each(cases)('masks a %s key', (_name, key) => {
    const masked = redactSecrets(`value: ${key} end`)
    expect(masked).not.toContain(key.slice(-12))
  })

  it.each([
    ['a Teams webhook', `https://contoso.webhook.office.com/webhookb2/${B62}@${B62}/IncomingWebhook/${B62}`, B62],
    ['a Zapier webhook', `https://hooks.zapier.com/hooks/catch/123456/${B62.slice(0, 10)}`, B62.slice(0, 10)],
    ['an X-Amz-Signature', `https://bucket.s3.amazonaws.com/k?X-Amz-Credential=x&X-Amz-Signature=${hex(64)}`, hex(64)],
    ['a ?jwt= parameter', `https://app.example.com/cb?jwt=${B62}`, B62],
  ])('masks %s', (_name, text, secret) => {
    expect(redactSecrets(text)).not.toContain(secret)
  })
})

// The seventh independent review.
describe('redactSecrets: the seventh review of the masking change', () => {
  // `^` with the m flag also matches after `\r`, U+2028, and U+2029, and the .netrc comment-line
  // pattern read on to the next `\n` from each: 400,000 characters took 34 seconds.
  it.each([
    ['comment lines ending in \\r after "default"', (k: number) => 'default ' + '#\r'.repeat(15_000 * k)],
    ['comment lines ending in U+2028 after "machine"', (k: number) => 'machine ' + '# '.repeat(15_000 * k)],
    ['comment lines ending in U+2029 after "default"', (k: number) => 'default ' + '# '.repeat(15_000 * k)],
    ['a \\r-only script with "default" in it', (k: number) => ('# default settings\r' + 'x=1\r').repeat(1_500 * k)],
  ])('takes linear time: %s', async (_name, text) => expectLinearRedaction(text), 60_000)

  it('still reads a .netrc entry across a comment line', () => {
    expect(redactSecrets('machine h\n# prod\nlogin u\npassword Hk3tR8pLq2Zx')).not.toContain('Hk3tR8pLq2Zx')
  })

  const t = 'Zq8vX2mPzR8vXw1yT4bNc7Lp'
  it.each([
    ['os.environ[…] =', `os.environ["OPENAI_API_KEY"] = "${t}"`],
    ['os.environ[…] = with a password', `os.environ["DB_PASSWORD"] = "${t}"`],
    ['process.env[…] =', `process.env["GITHUB_TOKEN"] = "${t}"`],
    ['ENV[…] =', `ENV["STRIPE_SECRET"] = "${t}"`],
    ['$_ENV[…] =', `$_ENV['DB_PASSWORD'] = '${t}';`],
    ['app.config[…] =', `app.config["SECRET_KEY"] = "${t}"`],
    ["data['password'] =", `data['password'] = '${t}'`],
    ['headers["Authorization"] = "Token …"', `headers["Authorization"] = "Token ${t}"`],
    ["req.headers['authorization'] = 'Basic …'", `req.headers['authorization'] = 'Basic ${t}'`],
    ["WordPress define('DB_PASSWORD', …)", `define('DB_PASSWORD', '${t}');`],
    ["WordPress define('AUTH_KEY', …)", `define('AUTH_KEY', '${t}');`],
    ['os.Setenv', `os.Setenv("API_TOKEN", "${t}")`],
    ['monkeypatch.setenv', `monkeypatch.setenv("DB_PASSWORD", "${t}")`],
    ['System.setProperty', `System.setProperty("javax.net.ssl.keyStorePassword", "${t}")`],
    ['an argument list', `["--password", "${t}"]`],
    ['an argument list, token', `subprocess.run(["tool", "--api-token", "${t}"])`],
  ])('masks %s', (_name, text) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(t)
    expect(redactSecrets(masked)).toBe(masked)
  })

  it.each([
    'os.environ["HOME"] = "/home/me"',
    "define('WP_DEBUG', true);",
    'os.Setenv("PATH", "/usr/bin")',
    '["--verbose", "--output", "out.json"]',
  ])('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})

// The eighth independent review.
describe('redactSecrets: the eighth review of the masking change', () => {
  const t = 'Zq8vX2mPzR8vXw1yT4bNc7Lp'
  // The Authorization branch of the named-value rules split the value with a `.` pattern, which
  // doesn't match `\r`, U+2028, or U+2029, and threw on a value holding one. In the Claude Code
  // plugin, that one line preserved nothing at every compaction while it was in the window.
  it.each([
    ['\\r', '\r'],
    ['U+2028', ' '],
    ['U+2029', ' '],
  ])('masks an Authorization value set by name with %s inside it', (_name, c) => {
    for (const text of [
      `headers["Authorization"] = "Token ${t}${c}${t}"`,
      `req.setHeader('Authorization', 'Bearer ${t}${c}x')`,
      `["--authorization", "${t}${c}"]`,
      `h["Proxy-Authorization"] = "${c}"`,
      `h["Authorization"] = "${c}${t}"`,
    ]) {
      const masked = redactSecrets(text)
      expect(masked).not.toContain(t)
      expect(redactSecrets(masked)).toBe(masked)
    }
  })

  // Every case the tests name, with each line terminator and a few other characters no rule
  // expects put at every position: masking never throws, whatever the text.
  it('never throws, whatever character lands inside a credential', () => {
    const lines = [
      ...FORMATS.map((f) => f.text),
      ...AUDIT3_FORMATS.map((f) => f.text),
      ...AUDIT3_LINES.map((f) => f.text),
      ...HARMLESS,
      `os.environ["OPENAI_API_KEY"] = "${t}"`,
      `define('DB_PASSWORD', '${t}');`,
      `["--password", "${t}"]`,
      `headers["Authorization"] = "Token ${t}"`,
      `{"Authorization": "Basic ${t}"}`,
      `Cookie: sessionid=${t}; theme=dark`,
      `document.cookie = "sid=${t}"`,
      `mysql -u root -p'${t}' db`,
      `curl -u admin:${t} https://x`,
      `sshpass -p ${t} ssh host`,
      `machine h login u password ${t}`,
      `db:5432:app:user:${t}`,
      `- name: DB_PASSWORD\n  value: ${t}`,
      `<add key="ApiKey" value="${t}"/>`,
      `IDENTIFIED BY '${t}'`,
      `パスワード: ${t}`,
    ]
    const odd = ['\r', '\n', '\r\n', ' ', ' ', '\0', '\t', '\\', '"', "'", '\uD800', '😀']
    let calls = 0
    for (const line of lines) {
      const step = Math.max(1, Math.floor(line.length / 40))
      for (let at = 0; at <= line.length; at += step) {
        for (const c of odd) {
          const text = line.slice(0, at) + c + line.slice(at)
          expect(() => redactSecrets(text), JSON.stringify(text)).not.toThrow()
          calls++
        }
      }
    }
    expect(calls).toBeGreaterThan(10_000)
  }, 60_000)
})

// The fourth audit (docs/audits/2026-09-30-audit-4-ja.md, P0-1, P2-9).
describe('redactSecrets: the fourth audit — unquoted values with punctuation', () => {
  it('masks the whole value in all 504 lines of the audit\'s sweep (28 symbols × 6 names × 3 separators)', () => {
    expect(ENV_SWEEP).toHaveLength(504)
    const leaked = ENV_SWEEP.filter(({ text }) => ENV_SWEEP_HALVES.some((half) => redactSecrets(text).includes(half)))
    expect(leaked.map((l) => l.text)).toEqual([])
  })

  it('masks the audit\'s own line, keeping the name', () => {
    expect(redactSecrets('DB_PASSWORD=Qx7vR2mK(pL9zW4tB')).toBe('DB_PASSWORD=[REDACTED]')
  })

  it('masks the same values with the symbol at the end, after export, and in a .env block with CRLF line ends', () => {
    const symbols = [...'!#$%&()*+,-./:;<=>?@[]^_{|}~']
    for (const symbol of symbols) {
      const value = `${ENV_SWEEP_HALVES[0]}${ENV_SWEEP_HALVES[1]}${symbol}`
      for (const text of [`DB_PASSWORD=${value}`, `export SMTP_PASS=${value}`, `  - AUTH_TOKEN=${value}`, `APP_ENV=production\r\nCLIENT_SECRET=${value}\r\nPORT=8080`]) {
        const masked = redactSecrets(text)
        expect(masked, text).not.toContain(ENV_SWEEP_HALVES[0])
        expect(masked, text).not.toContain(ENV_SWEEP_HALVES[1])
        expect(redactSecrets(masked)).toBe(masked)
      }
    }
    expect(redactSecrets('APP_ENV=production\nDB_PASSWORD=Qx7vR2mK;pL9zW4tB # rotated 2026-09\nPORT=8080')).toBe('APP_ENV=production\nDB_PASSWORD=[REDACTED] # rotated 2026-09\nPORT=8080')
  })

  it.each(AUDIT4_HARMLESS)('leaves %j as it is', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })

  // Where the audit found it: the package.json an eval session's agent read, whose jsonwebtoken
  // version is what that task is about (read here, not changed).
  it('keeps the dependency versions in examples/eval-sessions/webpack-upgrade.json', () => {
    const session = JSON.parse(readFileSync(new URL('../../../examples/eval-sessions/webpack-upgrade.json', import.meta.url), 'utf8')) as { messages: Array<{ content: unknown }> }
    const packageJson = (session.messages[6].content as Array<{ content: string }>)[0].content
    expect(packageJson).toContain('"jsonwebtoken": "^9.0.2"')
    expect(redactSecrets(packageJson)).toBe(packageJson)
  })
})

// General shapes behind what the Round 4 blind corpus's dev half (test/blind-redact-2) found; the
// examples here are this file's own, not the corpus's.
describe('redactSecrets: shapes from the Round 4 blind corpus\'s dev half', () => {
  it.each([
    'connecting to postgres://app:********@db.internal:5432/app (pool=10)',
    'DATABASE_URL=mysql://root:${DB_PASSWORD}@db:3306/shop',
    'spring.mail.password=${MAIL_PASSWORD:}',
    'password: ${spring.datasource.password}',
    'ANTHROPIC_API_KEY=sk-ant-...',
    'OPENAI_API_KEY=sk-proj-…',
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEq5HkQ8Y1b9c7Lp/t+DPw==',
    '- name: DB_PASSWORD\n  value: {{ .Values.postgresql.auth.password | quote }}',
  ])('leaves %j as it is', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })

  it('still masks a real password in the same places', () => {
    expect(redactSecrets('postgres://app:Zq8vX2mP@db.internal:5432/app')).toBe('postgres://app:[REDACTED]@db.internal:5432/app')
    expect(redactSecrets('spring.mail.password=${MAIL_PASSWORD:Zq8vX2mPz}')).toBe('spring.mail.password=[REDACTED]')
    expect(redactSecrets('- name: DB_PASSWORD\n  value: Zq8vX2mPz')).toBe('- name: DB_PASSWORD\n  value: [REDACTED]')
    expect(redactSecrets('ANTHROPIC_API_KEY=sk-ant-api03-Zq8vX2mPzR8vXw1yT4bNc7Lp')).toBe('ANTHROPIC_API_KEY=[REDACTED]')
  })

  it('masks a Datadog-style application key header', () => {
    expect(redactSecrets('-H "DD-APPLICATION-KEY: 4f2a9c1e7d3b8a6f0e5c2d9b1a7f3e8c4d6b2a9f"')).toBe('-H "DD-APPLICATION-KEY: [REDACTED]"')
  })
})

// The independent review of the fourth audit's masking change (PR #26): each of these was masked by
// 0.7.0 or is the kind of value the change set out to mask, and the first version of the change
// let it through.
describe('redactSecrets: the review of the fourth audit\'s masking change', () => {
  const pw = 'Qx7vR2mKpL9zW4tB'
  it.each([
    // 1. `${NAME-default}` (no colon): the default may be the secret, as with `${NAME:-default}`.
    `password: "\${DB_PASSWORD-${pw}}"`,
    `DATABASE_URL: postgres://app:\${POSTGRES_PASSWORD-${pw}}@db/app`,
    `password: '\${db.password-${pw}}'`,
    // 2. A URL's password that starts with `$`, or looks like `%X%` or `xxx…`.
    'mongodb+srv://admin:$tr0ngPassw0rdQx7@cluster0.mongodb.net/db',
    'redis://:$ecretRedis9Qx7vR2@cache:6379',
    'amqp://guest:%RABBITQx7vR2mK%@mq:5672',
    'https://user:xxxxxxxx@git.example.com/repo.git',
    // 3. A password that starts like a version, and a token with a long version-like suffix.
    `DB_PASSWORD=1.2-${pw}`,
    `password: v2.0.1-${pw}`,
    `password: "3.14-${pw}"`,
    `token: 1.2.3-${pw}`,
    `api_key=1.2.3+${pw}`,
    // 4. A secret cut short is still most of a secret.
    `password=${pw.slice(0, 12)}…`,
    'password=Hunter2Qx7...',
    'token=ghp_abcd1234efgh...',
    'password=Summer_2024_...',
    // 6. A password whose brackets balance isn't a call or a literal.
    `DB_PASSWORD=Qx7vR2mK(pL9zW4tB)`,
    '  password: P4ss(w0rdQx7vR2mK)',
    '  password: P4ss(w0rd)',
    `DB_PASSWORD=Qx7vR2mK[pL9zW4tB]`,
    `DB_PASSWORD=Qx7vR2mK(pL9zW4tB) # prod`,
    `DB_PASSWORD={${pw}}`,
    `DB_PASSWORD=[${pw}]`,
  ])('masks %j', (text) => {
    const masked = redactSecrets(text)
    for (const piece of [pw.slice(0, 8), pw.slice(8), 'tr0ngPassw0rd', 'ecretRedis9', 'RABBITQx7', 'w0rdQx7', 'abcd1234efgh', 'Hunter2', 'P4ss(w0rd)', 'xxxxxxxx', 'Summer_2024']) {
      if (text.includes(piece)) expect(masked).not.toContain(piece)
    }
    expect(masked).toContain('[REDACTED]')
  })

  it.each([
    'OPENAI_API_KEY=sk-...',
    'ANTHROPIC_API_KEY=sk-ant-api03-...',
    'GITHUB_TOKEN=ghp_…',
    '"next-auth": "4.24.5-beta.2"',
    '"jsonwebtoken": "9.0.0-rc.1"',
    'token = get_token()',
    'api_key = os.getenv("API_KEY")',
    'password = hash_password(raw, salt)',
    'secret = config.get(\'secret\', None)',
    'password: []',
    'auth: {}',
    'credentials: {"user": "bob"}',
  ])('still leaves %j as it is', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})

// The fifth audit (docs/audits/2026-10-01-audit-5-ja.md, improvement 2): a URL password holding
// `#`, `/`, or `?`, a passphrase with spaces, a non-ASCII value after a Japanese label.
describe('redactSecrets: the fifth audit\'s lines', () => {
  it.each(AUDIT5_LINES)('masks $name', ({ text, secrets }) => {
    const masked = redactSecrets(text)
    for (const secret of secrets) expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  it('keeps the host, the port, and the path of the audit\'s URL', () => {
    expect(redactSecrets('postgres://app:Pg#Secr3t99@db.internal:5432/app')).toBe('postgres://app:[REDACTED]@db.internal:5432/app')
    expect(redactSecrets('DATABASE_URL=mysql://root:a/b?c#d@db:3306/shop?ssl=true')).toBe('DATABASE_URL=mysql://root:[REDACTED]@db:3306/shop?ssl=true')
  })

  it('masks the whole passphrase and keeps the name', () => {
    expect(redactSecrets('JWT_SECRET=correct horse battery staple')).toBe('JWT_SECRET=[REDACTED]')
    expect(redactSecrets('DB_PASSWORD = correct horse battery staple # rotated')).toBe('DB_PASSWORD = [REDACTED] # rotated')
    expect(redactSecrets('パスワード: Hunter2の秘密')).toBe('パスワード: [REDACTED]')
  })

  it.each(AUDIT5_HARMLESS)('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})

// General shapes added after Round 5's blind corpus's dev half (test/blind-redact-3/) showed them
// missing or over-masked. The examples are this file's own, not the corpus's.
describe('redactSecrets: shapes added from the Round 5 blind corpus\'s dev half', () => {
  const pw = 'Hq7rT2vLm9Xc'
  const leaks: Array<[string, string, string]> = [
    ['a WireGuard preshared key', `[Peer]\nPresharedKey = ${pw}Zw4Pq8Ns6Ty1Bv3Kd5Rf0Ga=`, pw],
    ['a wpa_supplicant psk', 'network={\n    ssid="office"\n    psk="lantern 42 copper meadow"\n}', 'lantern 42 copper'],
    ['a Portuguese name', `app.senha=${pw}`, pw],
    ['a German name', `Kennwort=${pw}`, pw],
    ['a Korean label', `서버 비밀번호: ${pw} 입니다`, pw],
    ['a Chinese label', `数据库密码：${pw}，请勿外传`, pw],
    ['a Turkish label', `Veritabanı şifresi: Çğ${pw}`, pw],
    ['a Russian label', `пароль: ${pw}`, pw],
    ['a French label, a space before the colon', `mot de passe : ${pw}`, pw],
    ['a Spanish label', `contraseña=${pw}`, pw],
    ['an Italian label', `chiave API: ${pw}`, pw],
    ['ssh-keygen -P and -N, the old passphrase', `ssh-keygen -p -f key -P '${pw}' -N 'river stone'`, pw],
    ['ssh-keygen -P and -N, the new passphrase', `ssh-keygen -p -f key -P '${pw}' -N 'river stone 81'`, 'river stone 81'],
    ['7z -p with a quoted passphrase', `7z a -p"cobalt ${pw} tide" -mhe=on out.7z ./dir`, pw],
    ['7z -p run together', `7z x -p${pw} backup.7z`, pw],
    ['unzip -P', `unzip -P ${pw} bundle.zip`, pw],
    ['redis.conf requirepass', `port 6379\nrequirepass ${pw}\nappendonly yes`, pw],
    ['redis.conf masterauth', `masterauth ${pw}`, pw],
    ['a redis MONITOR AUTH line', `1784747937.595199 [0 10.0.0.9:41256] "AUTH" "${pw}"`, pw],
    ['a redis MONITOR AUTH line with a user', `1784747937.595199 [0 10.0.0.9:41256] "AUTH" "default" "${pw}"`, pw],
    ['redis-cli AUTH at its prompt', `127.0.0.1:6379> AUTH ${pw}`, pw],
    ['a Rust typed constant', `const API_KEY: &str = "${pw}";`, pw],
    ['a TypeScript typed constant', `export const apiToken: string = '${pw}'`, pw],
    ['a Python annotated constant', `SECRET_KEY: Final[str] = "${pw}"`, pw],
  ]
  it.each(leaks)('masks: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  const harmless = [
    '[db]\npassword = %(db_password)s\nhost = %(db_host)s',
    'implementation("org.jsonwebtoken:jjwt-core:2.1.0")',
    'curl -u "$REPO_USER:$REPO_PASS" --upload-file a.jar https://repo.example/x',
    'mysql -u app -p$DB_PASS shop',
    '  password = var.admin_password',
    '  token    = local.api_token',
    'curl -H "X-Api-Key: $env:MY_API_KEY" https://api.example/v1',
    'PublicKey = Zw4Pq8Ns6Ty1Bv3Kd5Rf0GaHq7rT2vLm9Xc=',
    'AUTH failed for user',
    '비밀번호를 변경했습니다',
    '密码：请联系管理员',
    'const apiUrl: string = "https://api.example/v1"',
    'archive.7z -p8080 -o out',
  ]
  it.each(harmless)('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})

// The independent review of Round 5's masking change (before merging): regressions against 0.7.1
// and gaps in the shapes it claimed to handle.
describe('redactSecrets: the review of Round 5\'s masking change', () => {
  const leaks: Array<[string, string, string]> = [
    ['a single-quoted $ password after mysql -p (0.7.1 masked it)', "mysql -u root -p'$uperS3cret' mydb", 'uperS3cret'],
    ['a single-quoted $ password after curl -u (0.7.1 masked it)', "curl -u 'admin:$ecretPass9' https://api.example.com", 'ecretPass9'],
    ['a single-quoted $ password after sshpass -p', "sshpass -p '$uperS3cret' ssh deploy@host", 'uperS3cret'],
    ['a single-quoted $ password after redis-cli -a', "redis-cli -a '$uperS3cret' ping", 'uperS3cret'],
    ['a % password after curl -u (0.7.1 masked it)', 'curl -u admin:%Secret1 https://x', 'Secret1'],
    ['a single-quoted % password after mysql -p', "mysql -p'%Passw0rd' db", 'Passw0rd'],
    ['a password that only starts like a Terraform reference', 'DB_PASSWORD=local.Pa55word!', 'Pa55word'],
    ['a token that only starts like a Terraform reference', 'API_TOKEN=var.abc123def456ghi789', 'abc123def456ghi789'],
    ['a URL password with digits before #', 'postgres://admin:2024#Summer@db:5432/app', 'Summer'],
    ['a URL password with digits before /', 'postgres://admin:123/abc@db:5432/app', '123/abc'],
    ['a URL whose host is followed by ":"', 'failed to connect to postgres://u:Pg#Secr3t99@db.internal:5432: connection refused', 'Secr3t99'],
    ['a URL in Markdown bold', '**postgres://u:Pg#Secr3t99@db**', 'Secr3t99'],
    ['an Azure user name with @, and #', 'postgres://myadmin@myserver:Pg#Secr3t99@myserver.postgres.database.azure.com:5432/db', 'Secr3t99'],
    ['an Azure user name with @', 'postgres://myadmin@myserver:Secr3t99xQ@myserver.postgres.database.azure.com:5432/db', 'Secr3t99xQ'],
    ['a passphrase in YAML under a secret\'s name', 'jwt_secret: correct horse battery staple', 'horse battery staple'],
    ['a passphrase in YAML under a client secret', 'client_secret: my super secret phrase 42', 'super secret phrase'],
    ['a passphrase in a YAML list item', '- password: correct horse battery staple', 'horse battery staple'],
    ['a tab before a quoted passphrase flag', 'tool\t--passphrase "correct horse battery"', 'horse battery'],
  ]
  it.each(leaks)('masks: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  const harmless = [
    'mysql -u app -p"$DB_PASS" shop',
    'curl -u admin:%DB_PASS% https://x',
    'auth required pam_deny.so',
    'auth include system-auth',
    'auth required pam_google_authenticator.so',
    'AUTH LOGIN',
    'AUTH CRAM-MD5',
    'secret = a if b else c',
    'token = token or default',
    'auth = basic or digest',
    'token = await fetch',
    'SECRET_KEY=dev python manage.py runserver',
    'TOKEN=abc123 make deploy',
    '最大トークン: 128k',
    'トークン：1.5k',
    'トークン: GPT-4では128kまで',
    'パスワード: UTF-8で保存',
    '암호: AES-256',
    '  password = local.db_password',
    'zip the logs then rsync -P logs.zip host:',
    'archive.7z -p8080',
    'def connect(token: str = "default")',
    'http://localhost:8080/#/users/@alice',
  ]
  it.each(harmless)('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})

// The re-review of Round 5's masking change: a value after a Japanese (or other) label was masked
// only up to an ASCII `(` or its 256th character, leaving the rest, which 0.7.1 masked whole; and
// documentation under a setting's name (`api_key: Your Anthropic API key.`) read as a passphrase.
describe('redactSecrets: the re-review of Round 5\'s masking change', () => {
  const longToken = `${'eyJzdWIiOiIxMjM0NTY3ODkwIn0'.repeat(10)}SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV`
  const leaks: Array<[string, string, string]> = [
    ['a Japanese-labelled value with "(" (0.7.1 masked it)', 'パスワード: Pass1(word99xyz', 'word99xyz'],
    ['a Japanese-labelled value with "(…)" (0.7.1 masked it)', 'DBのパスワード: S3cr3t(2024)Prod', '(2024)Prod'],
    ['a token over 256 characters after トークン (0.7.1 masked it)', `トークン: ${longToken}`, 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'],
    ['a key over 256 characters after APIキー (0.7.1 masked it)', `APIキー: ${'8kL0zX2cV4bN6mQ8wE0r'.repeat(15)}Zq9Tail77`, 'Zq9Tail77'],
    ['a value over 256 characters after 密码', `密码: ${'8kL0zX2cV4bN6mQ8wE0r'.repeat(15)}Zq9Tail77`, 'Zq9Tail77'],
    ['zip -9 -P', 'zip -9 -P S3cret99x out.zip a.txt', 'S3cret99x'],
    ['zip -r9 -P', 'zip -r9 -P S3cret99x out.zip dir', 'S3cret99x'],
    ['a quoted redis password with spaces', 'requirepass "my redis pass 42"', 'redis pass 42'],
  ]
  it.each(leaks)('masks: %s', (_name, text, secret) => {
    const masked = redactSecrets(text)
    expect(masked).not.toContain(secret)
    expect(redactSecrets(masked)).toBe(masked)
  })

  const harmless = [
    '            api_key: Your Anthropic API key.',
    '        access_token: Optional bearer token for auth',
    '    access_token : str, optional',
    '      invalid_token: Invalid authentication token.',
    'github_token: required for private repos',
    'client_secret: from the Azure portal',
    'refresh_token: null until first login',
    'pip install git+ssh://git@github.com:org/repo.git@v1.2.3',
    'poetry add git+ssh://git@github.com:sdispater/pendulum.git@develop',
  ]
  it.each(harmless)('leaves alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })
})
