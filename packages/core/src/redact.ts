/**
 * Best-effort masking of common secret shapes before any text leaves the machine (sent to Jev) or
 * lands on disk (the Claude Code plugin's cache). Real transcripts routinely contain keys pasted
 * into chat or echoed by a tool — this catches the recognizable formats, not every possible
 * secret, so it narrows the exposure rather than eliminating it.
 *
 * Three kinds of rule, applied in this order:
 * - formats that are a secret wherever they appear (a provider's key prefix, a private key block);
 * - a secret in a known position (a URL's password, an Authorization header, `mysql -p…`);
 * - the value of anything named like a credential (`DB_PASS=…`, `"apiKey": "…"`, `パスワード：…`).
 *
 * Callers mask before cutting text short, never after (see entryText.ts): a cut can leave half a
 * token that no longer matches any rule here.
 */
const REDACTED = '[REDACTED]'

// A value that's already masked, possibly cut at its closing bracket by a value pattern below.
const isMasked = (value: string) => value.startsWith(REDACTED.slice(0, -1))

/** [pattern, replacement]: `$1` keeps a prefix that isn't secret (a host, a header name). */
const TOKEN_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED], // Anthropic (sk-ant-...), OpenAI (sk-proj-...), and similar
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED], // Stripe secret and restricted keys
  [/\bwhsec_[A-Za-z0-9]{16,}/g, REDACTED], // Stripe webhook signing secret
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, REDACTED], // GitLab
  [/\bnpm_[A-Za-z0-9]{36}\b/g, REDACTED],
  [/\bhf_[A-Za-z0-9]{30,}\b/g, REDACTED], // Hugging Face
  [/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, REDACTED], // SendGrid
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED], // AWS access key ids, long-term and temporary
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED], // Slack tokens
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED], // Google API key
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, REDACTED], // Google OAuth access token
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED], // JWT
  // Webhook URLs are their own credential: anyone holding one can post.
  [/(\bhttps:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9/_-]+/g, `$1${REDACTED}`],
  [/(\bhttps:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/)[0-9]+\/[A-Za-z0-9_-]+/g, `$1${REDACTED}`],
]

const POSITIONAL_PATTERNS: Array<[RegExp, string]> = [
  // scheme://user:password@host — the password may itself contain "@", so it runs to the last one.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/?#@"'<>]+:)[^\s/?#"'<>]*(@)/gi, `$1${REDACTED}$2`],
  // An Authorization header's credentials, whatever the scheme.
  [/(\b(?:Proxy-)?Authorization[ \t]*[:=][ \t]*["']?(?:(?:Bearer|Basic|Token|Digest|Bot)[ \t]+)?)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`],
  // mysql -u root -pS3cret (the password is glued to -p) and curl -u user:password.
  [/(\bmysql(?:dump|admin|import|sh)?\b[^\n]*?\s-p)(["']?)(?!\s)[^\s'"]+\2/g, `$1$2${REDACTED}$2`],
  [/(\bcurl\b[^\n]*?\s(?:-u|--user)[ \t=]+["']?[^\s:'"]+:)[^\s'"]+/g, `$1${REDACTED}`],
  // --password S3cret, --token abc… as separate arguments.
  [/(\s--(?:password|passwd|token|secret|api[-_]?key|client[-_]secret|auth[-_]token)[ \t]+)(?!-)[^\s'"]+/gi, `$1${REDACTED}`],
]

// An AWS secret access key has no prefix of its own: 40 characters of base64. Only masked with
// "aws" or "secret" shortly before it, and only with mixed case and a digit, so a 40-character git
// commit hash (lowercase hex) never matches.
const AWS_SECRET_CANDIDATE = /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/g
const AWS_SECRET_CONTEXT = /aws|secret/i
const looksLikeAwsSecret = (value: string) => /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value)

// NAME=value, NAME: value, "name": "value", name => 'value', … The name is kept (it's useful
// context — "the API key was set") and only the value is masked. Whether NAME is a credential is
// decided on its words (see credentialKind), not a substring, so `tokenizer: gpt-tokenizer4` and
// `maxTokens=100000` stay as they are. The name may be quoted, including as escaped JSON (\"…\").
const ASSIGNMENT =
  /(\\?["']?)\b([A-Za-z_][A-Za-z0-9_.-]*)\1([ \t]*(?:=>|:=|[:=])[ \t]*)(?:\\"((?:[^"\\\n]|\\[^"\n])*)\\"|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`\n]*)`|([^\s"'`,;&<>(){}[\]\\]+))/g

// The same in Japanese ("パスワード：…", "APIキー: …"). The value must be ASCII so that prose after
// the colon ("トークン：有効期限切れ") isn't masked along with it.
const JA_ASSIGNMENT = /((?:API|アクセス|シークレット)\s?キー|パスワード|パスフレーズ|シークレット|トークン|秘密鍵)(\s*[:=：]\s*)(["'「]?)([!#-&(-~]{8,})/gi

type CredentialKind = 'password' | 'token'

const PASSWORD_WORDS = new Set(['password', 'passwd', 'passwort', 'pwd', 'pw', 'pass', 'passphrase'])
const PASSWORD_SUFFIXES = ['password', 'passwd', 'passphrase']
const TOKEN_WORDS = new Set(['secret', 'token', 'apikey', 'credential', 'credentials', 'auth', 'cookie'])
const TOKEN_SUFFIXES = ['secret', 'token', 'apikey']
// "<qualifier> key" is a credential (api key, secret key, account key); a bare "key" usually isn't.
const KEY_QUALIFIERS = new Set(['api', 'access', 'secret', 'private', 'signing', 'encryption', 'master', 'account', 'shared', 'client', 'app', 'service', 'license', 'subscription', 'admin', 'auth', 'webhook', 'deploy'])
// Words that can follow the credential without changing what it is: SECRET_KEY_BASE, token_value.
const TRAILING_WORDS = new Set(['base', 'value', 'b64', 'base64', 'plain', 'plaintext', 'raw'])

/** Splits `dbPassword`, `DB_PASSWORD`, `x-api-key`, `spring.datasource.password` into lowercase words. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter(Boolean)
}

/** Whether NAME in `NAME=value` names a credential, by its last meaningful word. */
function credentialKind(name: string): CredentialKind | undefined {
  const words = nameWords(name)
  while (words.length > 1 && TRAILING_WORDS.has(words[words.length - 1])) words.pop()
  const last = words[words.length - 1]
  if (!last) return undefined
  if (PASSWORD_WORDS.has(last) || PASSWORD_SUFFIXES.some((s) => last.endsWith(s))) return 'password'
  if (TOKEN_WORDS.has(last) || TOKEN_SUFFIXES.some((s) => last.endsWith(s))) return 'token'
  if (last === 'key' && words.length > 1 && KEY_QUALIFIERS.has(words[words.length - 2])) return 'token'
  return undefined
}

// Not a secret: a type, a placeholder, a reference to where the secret actually lives.
const PLACEHOLDER =
  /^(?:true|false|null|nil|none|undefined|yes|no|on|off|required|optional|string|str|number|int|boolean|bool|\*+|x{3,}|\.{3}|…|<[^>]*>|\{\{.*\}\}|\$\{?[A-Za-z_]\w*\}?|%[A-Za-z_]\w*%?)$/i
const REFERENCE = /^(?:process\.env|os\.environ|import\.meta\.env|ENV\[|System\.getenv|getenv)/

/** `next` is the character right after the value: an unquoted value followed by `(` or `[` is code (`token = get_token()`). */
function isMaskableValue(value: string, kind: CredentialKind, bare: boolean, next: string | undefined): boolean {
  if (value.length === 0 || isMasked(value) || PLACEHOLDER.test(value) || REFERENCE.test(value)) return false
  if (bare && (next === '(' || next === '[')) return false
  if (kind === 'password') return true
  // A purely numeric value (MAX_TOKENS=100000) is a setting, not a secret.
  if (/^\d+$/.test(value)) return false
  return !bare || value.length >= 8
}

export function redactSecrets(text: string): string {
  let out = text
  for (const [pattern, replacement] of TOKEN_PATTERNS) out = out.replace(pattern, replacement)
  for (const [pattern, replacement] of POSITIONAL_PATTERNS) out = out.replace(pattern, replacement)
  out = out.replace(AWS_SECRET_CANDIDATE, (match: string, offset: number, whole: string) =>
    looksLikeAwsSecret(match) && AWS_SECRET_CONTEXT.test(whole.slice(Math.max(0, offset - 100), offset)) ? REDACTED : match,
  )
  out = out.replace(ASSIGNMENT, (match: string, quote: string, name: string, sep: string, escaped: string | undefined, dq: string | undefined, sq: string | undefined, bq: string | undefined, bare: string | undefined, offset: number, whole: string) => {
    const kind = credentialKind(name)
    const value = escaped ?? dq ?? sq ?? bq ?? bare ?? ''
    // Unquoted, a value may also be prose ("Token: expired yesterday"): see isMaskableValue.
    if (!kind || !isMaskableValue(value, kind, bare !== undefined, whole[offset + match.length])) return match
    const masked =
      escaped !== undefined ? `\\"${REDACTED}\\"` : dq !== undefined ? `"${REDACTED}"` : sq !== undefined ? `'${REDACTED}'` : bq !== undefined ? `\`${REDACTED}\`` : REDACTED
    return `${quote}${name}${quote}${sep}${masked}`
  })
  out = out.replace(JA_ASSIGNMENT, (match, name, sep, quote, value) =>
    /^\d+$/.test(value) || isMasked(value) ? match : `${name}${sep}${quote}${REDACTED}`,
  )
  return out
}
