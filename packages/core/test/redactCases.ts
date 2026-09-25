/**
 * Secret-masking cases shared by src/redact.test.ts and anything that measures redactSecrets()'s
 * coverage. Kept outside src/ so they aren't built into the published package.
 */

// Fake values, assembled at runtime so no provider-shaped literal sits in the source (a scanner
// would rightly flag one). None of these is a real credential.
export const j = (...parts: string[]) => parts.join('')
export const B62 = 'A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S7t8U9v0'
export const PW = 'S3cretPassw0rd'

/**
 * The 2026-09-24 audit (docs/audits/2026-09-24-audit-ja.md, section 4.6) tried 40 secret formats
 * and found 21 passing through. It names the misses but doesn't list all 40, so this table is a
 * reconstruction: every format the audit names, plus the formats redact.ts already handled.
 * `secret` is the part that must not survive masking.
 */
export const FORMATS: Array<{ name: string; text: string; secret: string }> = [
  // Formats handled before the audit.
  { name: 'Anthropic key', text: `key: ${j('sk-ant-', 'api03-', B62)}`, secret: B62 },
  { name: 'OpenAI project key', text: `OPENAI=${j('sk-proj-', B62)}`, secret: B62 },
  { name: 'GitHub classic PAT', text: `token ${j('ghp', '_', B62)}`, secret: B62 },
  { name: 'GitHub OAuth token', text: `using ${j('gho', '_', B62)} now`, secret: B62 },
  { name: 'GitHub fine-grained PAT', text: `${j('github', '_pat_', '11ABCDEFG0', B62)}`, secret: B62 },
  { name: 'AWS access key id', text: `aws_access_key_id = ${j('AKIA', 'IOSFODNN7EXAMPLE')}`, secret: 'IOSFODNN7EXAMPLE' },
  { name: 'Slack bot token', text: `SLACK=${j('xoxb', '-123456789012-', 'abcdefghijklmnop')}`, secret: 'abcdefghijklmnop' },
  { name: 'Google API key', text: `maps key ${j('AIza', 'SyA1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S')}`, secret: 'SyA1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S' },
  { name: 'JWT', text: `cookie ${j('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0In0', '.', 'dozjgNryP4J3jVmNHl0w5N')}`, secret: 'dozjgNryP4J3jVmNHl0w5N' },
  { name: 'Bearer header', text: `Authorization: Bearer ${B62}`, secret: B62 },
  { name: 'PEM RSA private key', text: `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA${B62}\n-----END RSA PRIVATE KEY-----`, secret: B62 },
  { name: 'OpenSSH private key', text: `-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA${B62}\n-----END OPENSSH PRIVATE KEY-----`, secret: B62 },
  { name: 'env API key', text: `export TYPESAFE_API_KEY=${B62}`, secret: B62 },
  { name: 'YAML password (8+ chars)', text: `password: ${PW}`, secret: PW },
  { name: 'SECRET_KEY assignment', text: `SECRET_KEY=${B62}`, secret: B62 },
  { name: 'GITHUB_TOKEN assignment', text: `GITHUB_TOKEN="${B62}"`, secret: B62 },
  { name: 'Japanese パスワード', text: `パスワード：${PW} です`, secret: PW },
  { name: 'Japanese APIキー', text: `APIキー: "${B62}"`, secret: B62 },
  { name: 'AWS secret assignment', text: `aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`, secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
  // Formats the audit found passing through.
  { name: 'JSON password', text: `{"password": "${PW}"}`, secret: PW },
  { name: 'JSON apiKey', text: `{"user": "ci", "apiKey": "${B62}"}`, secret: B62 },
  { name: 'JSON client_secret', text: `{"client_id": "abc", "client_secret": "${B62}"}`, secret: B62 },
  { name: 'URL password in DATABASE_URL', text: `DATABASE_URL=postgres://admin:${PW}@db.internal:5432/app`, secret: PW },
  { name: 'URL password in a git remote', text: `git push https://deploy:${PW}@github.com/org/repo.git`, secret: PW },
  { name: 'Stripe live secret key', text: `stripe: ${j('sk', '_live_', B62)}`, secret: B62 },
  { name: 'Stripe restricted key', text: `STRIPE=${j('rk', '_live_', B62)}`, secret: B62 },
  { name: 'GitLab PAT', text: `CI uses ${j('glpat', '-', 'xYz12AbC34dEf56GhI78')}`, secret: 'xYz12AbC34dEf56GhI78' },
  { name: 'npm token', text: `//registry.npmjs.org/:_authToken=${j('npm', '_', 'A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S7t8')}`, secret: 'A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S7t8' },
  { name: 'Hugging Face token', text: `login with ${j('hf', '_', 'A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S7')}`, secret: 'A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S7' },
  { name: 'SendGrid key', text: `mail key ${j('SG', '.', 'A1b2C3d4E5f6G7h8J9k0', '.', 'L1m2N3p4Q5r6S7t8U9v0W1x2')}`, secret: 'L1m2N3p4Q5r6S7t8U9v0W1x2' },
  { name: 'Slack webhook URL', text: `curl -X POST ${j('https://hooks.', 'slack.com', '/services/', 'T00000000/B00000000/', 'XXXXXXXXXXXXXXXXXXXXXXXX')}`, secret: 'XXXXXXXXXXXXXXXXXXXXXXXX' },
  { name: 'AWS temporary key id', text: `AccessKeyId: ${j('ASIA', 'Y34FZKBOKMUTVV7A')}`, secret: 'Y34FZKBOKMUTVV7A' },
  { name: 'AWS secret key in prose', text: 'the AWS secret access key is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY, rotate it', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
  { name: 'Authorization: Basic', text: 'curl -H "Authorization: Basic ZGVwbG95OlMzY3JldFBhc3N3MHJk" https://api.example.com', secret: 'ZGVwbG95OlMzY3JldFBhc3N3MHJk' },
  { name: 'DB_PASS (short)', text: 'DB_PASS=hunter2', secret: 'hunter2' },
  { name: 'password under 8 characters', text: 'password: abc123', secret: 'abc123' },
  { name: 'Azure AccountKey', text: `DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=${B62}+Zz==;EndpointSuffix=core.windows.net`, secret: B62 },
  { name: 'mysql -p', text: `mysql -u root -p${PW} orders`, secret: PW },
  { name: 'curl -u user:password', text: `curl -u deploy:${PW} https://ci.example.com/api`, secret: PW },
  { name: 'JSON OAuth access token', text: `{"access_token": "${j('ya29', '.', 'a0AfH6SMBx', B62)}", "expires_in": 3599}`, secret: B62 },
]

/** Text that must come back unchanged: near-misses for the rules above. */
export const HARMLESS = [
  'tokenizer: gpt-tokenizer4',
  '{"tokenizer": "gpt-tokenizer4", "maxTokens": 4096}',
  'max_tokens: 4096',
  'https://github.com/x96x64/ctxjev/tree/main/packages/core#readme',
  'https://example.com:8443/api/v1/users?page=2&sort=name',
  'postgres://localhost:5432/app',
  'git@github.com:x96x64/ctxjev.git',
  'request id 3f2b9c1e-7d4a-4c1b-9e0f-1a2b3c4d5e6f failed',
  'commit 2cf4eba8e051b5cf2b1efdf48477ba32f984ac64 (2cf4eba)',
  'the aws secret rotation landed in 2cf4eba8e051b5cf2b1efdf48477ba32f984ac64',
  'The password must be at least 12 characters; rotate the API token every 90 days.',
  'password_min_length: 12',
  '{"passwordPolicy": "strict"}',
  'SECRET_NAME=prod-db-credentials',
  'npm test && npm_config_cache=/tmp/npm-cache npm ci',
  'hf_hub_download(repo_id="bert-base-uncased")',
  'Basic usage: ctxjev analyze transcript.json',
  'token = get_token()',
  'password: string',
  'export const password = process.env.DB_PASSWORD',
  'Authorization: Bearer ${TOKEN}',
  'トークン：有効期限切れのため再発行',
]
