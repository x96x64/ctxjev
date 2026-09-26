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
  it('takes linear time on comment blocks with trailing whitespace', () => {
    const scale = Number(process.env.CTXJEV_TIME_LIMIT_SCALE ?? 1)
    const texts = [
      '#!/bin/bash\r\n#   --mode MODE   release or debug; release is the default\r\n' + '#   more help text here\r\n'.repeat(2000),
      'use the default\r\n' + '# comment\r\n'.repeat(5000),
      'machine example.com\n' + '# comment \n'.repeat(5000) + 'login u\npassword Hk3tR8pLq2Zx',
    ]
    for (const text of texts) {
      const start = performance.now()
      redactSecrets(text)
      expect(performance.now() - start).toBeLessThan(1000 * scale)
    }
    expect(redactSecrets(texts[2])).not.toContain('Hk3tR8pLq2Zx')
  })
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

  it('takes linear time on joined Authorization labels', () => {
    const scale = Number(process.env.CTXJEV_TIME_LIMIT_SCALE ?? 1)
    for (const unit of ['Authorization=', 'Proxy-Authorization=']) {
      const text = unit.repeat(Math.ceil(300_000 / unit.length)) + ': '
      const start = performance.now()
      redactSecrets(text)
      expect(performance.now() - start).toBeLessThan(2000 * scale)
    }
  })
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
  const scale = Number(process.env.CTXJEV_TIME_LIMIT_SCALE ?? 1)
  it.each([
    ['curl -u followed by a run of "="', 'curl -u' + '='.repeat(300_000)],
    ['mysql mentioned over and over with no -p', 'mysql '.repeat(50_000)],
    ['curl mentioned over and over on one line', 'curl -H x '.repeat(30_000) + '-u admin:S3cretPw9xQ'],
  ])('takes linear time: %s', (_name, text) => {
    const start = performance.now()
    redactSecrets(text)
    expect(performance.now() - start).toBeLessThan(2000 * scale)
  })

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
  const scale = Number(process.env.CTXJEV_TIME_LIMIT_SCALE ?? 1)
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
    ['-eyJ repeated', '-eyJ'.repeat(75_000)],
    ['x-eyJ0-x-eyJ1-… repeated', Array.from({ length: 30_000 }, (_, i) => `x-eyJ${i}-`).join('')],
    ['_eyJ repeated', '_eyJ'.repeat(75_000)],
    ['a. repeated before ://', 'a.'.repeat(150_000) + '://'],
  ])('takes linear time: %s', (_name, text) => {
    const start = performance.now()
    redactSecrets(text)
    expect(performance.now() - start).toBeLessThan(2000 * scale)
  })
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
  const scale = Number(process.env.CTXJEV_TIME_LIMIT_SCALE ?? 1)
  // `^` with the m flag also matches after `\r`, U+2028, and U+2029, and the .netrc comment-line
  // pattern read on to the next `\n` from each: 400,000 characters took 34 seconds.
  it.each([
    ['comment lines ending in \\r after "default"', 'default ' + '#\r'.repeat(150_000)],
    ['comment lines ending in U+2028 after "machine"', 'machine ' + '# '.repeat(150_000)],
    ['comment lines ending in U+2029 after "default"', 'default ' + '# '.repeat(150_000)],
    ['a \\r-only script with "default" in it', ('# default settings\r' + 'x=1\r').repeat(15_000)],
  ])('takes linear time: %s', (_name, text) => {
    const start = performance.now()
    redactSecrets(text)
    expect(performance.now() - start).toBeLessThan(2000 * scale)
  })

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
