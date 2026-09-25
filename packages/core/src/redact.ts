/**
 * Best-effort masking of common secret shapes before any text leaves the machine (sent to Jev) or
 * lands on disk (the Claude Code plugin's cache). Real transcripts routinely contain keys pasted
 * into chat or echoed by a tool — this catches the recognizable formats, not every possible
 * secret, so it narrows the exposure rather than eliminating it.
 *
 * Three kinds of rule, applied in this order:
 * - formats that are a secret wherever they appear (a provider's key prefix, a private key block,
 *   a payment card number);
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
  // PEM (RSA, EC, OpenSSH, …) and PGP (`-----BEGIN PGP PRIVATE KEY BLOCK-----`) private keys.
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, REDACTED],
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g, REDACTED], // Anthropic (sk-ant-...), OpenAI (sk-proj-...), and similar
  [/(?<![A-Za-z0-9])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED], // Stripe secret and restricted keys
  [/(?<![A-Za-z0-9])whsec_[A-Za-z0-9]{16,}/g, REDACTED], // Stripe webhook signing secret
  [/(?<![A-Za-z0-9])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])glpat-[A-Za-z0-9_-]{20,}/g, REDACTED], // GitLab
  [/(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])hf_[A-Za-z0-9]{30,}\b/g, REDACTED], // Hugging Face
  [/(?<![A-Za-z0-9])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, REDACTED], // SendGrid
  [/(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED], // AWS access key ids, long-term and temporary
  [/(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED], // Slack tokens
  [/(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}\b/g, REDACTED], // Google API key
  [/(?<![A-Za-z0-9])ya29\.[0-9A-Za-z_-]{20,}/g, REDACTED], // Google OAuth access token
  [/(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED], // JWT
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

// A payment card number: 13–19 digits, run together or grouped the way cards print them (4-4-4-4,
// 4-4-4-4-3, Amex 4-6-5, Diners 4-6-4) with one kind of separator, that starts like a card brand
// and passes the Luhn check. Both conditions together keep timestamps, ids, and phone numbers out:
// a millisecond timestamp starts with 1, which no brand does.
const CARD_CANDIDATE = /(?<![\d.-])(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{1,4}(?:\1\d{3})?|\d{4}([ -])\d{6}\2\d{4,5})(?![\d-]|\.\d)/g
const CARD_BRAND = /^(?:4|5[1-5]|2[2-7]|3[47]|3(?:0[0-5]|[68])|35|6(?:011|5|4[4-9]|2))/

function looksLikeCardNumber(match: string): boolean {
  const digits = match.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19 || !CARD_BRAND.test(digits)) return false
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

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
  out = out.replace(CARD_CANDIDATE, (match: string) => {
    if (looksLikeCardNumber(match)) return REDACTED
    // 4-4-4-4 followed by three more digits: a 19-digit card, or a 16-digit one and its CVC.
    const sixteen = /^(\d{4}([ -])\d{4}\2\d{4}\2\d{4})(\2\d{3})$/.exec(match)
    return sixteen && looksLikeCardNumber(sixteen[1]) ? `${REDACTED}${sixteen[3]}` : match
  })
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
