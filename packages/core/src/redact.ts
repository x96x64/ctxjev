/**
 * Best-effort masking of common secret shapes before any text leaves the machine (sent to Jev) or
 * lands on disk (the Claude Code plugin's cache). Real transcripts routinely contain keys pasted
 * into chat or echoed by a tool — this catches the recognizable formats, not every possible
 * secret, so it narrows the exposure rather than eliminating it.
 *
 * Three kinds of rule, applied in this order:
 * - formats that are a secret wherever they appear (a provider's key prefix, a private key block,
 *   a payment card number);
 * - a secret in a known position (a URL's password, an Authorization header, `mysql -p…`, a URL
 *   query parameter such as `?sig=…`);
 * - the value of anything named like a credential (`DB_PASS=…`, `"apiKey": "…"`, `パスワード：…`),
 *   wherever it sits: after a label (`Error: DB_PASSWORD=…`), inside a URL, inside another value.
 *
 * Every quantifier that can repeat over the input is bounded, or anchored so it can't restart at
 * every position: a long run of one character (a log's separator line, a minified file) must cost
 * linear time, not quadratic.
 *
 * Callers mask before cutting text short, never after (see entryText.ts): a cut can leave half a
 * token that no longer matches any rule here.
 */
const REDACTED = '[REDACTED]'

// A value that's already masked, possibly cut at its closing bracket by a value pattern below.
const isMasked = (value: string) => value.startsWith(REDACTED.slice(0, -1))

type Rule = [RegExp, string | ((match: string, ...groups: string[]) => string)]

const applyRule = (text: string, [pattern, replacement]: Rule) =>
  typeof replacement === 'string' ? text.replace(pattern, replacement) : text.replace(pattern, replacement)

/** [pattern, replacement]: `$1` keeps a prefix that isn't secret (a host, a header name). */
const TOKEN_PATTERNS: Rule[] = [
  // PEM (RSA, EC, OpenSSH, …) and PGP (`-----BEGIN PGP PRIVATE KEY BLOCK-----`) private keys.
  [/-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g, REDACTED],
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g, REDACTED], // Anthropic (sk-ant-...), OpenAI (sk-proj-...), and similar
  [/(?<![A-Za-z0-9])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED], // Stripe secret and restricted keys
  [/(?<![A-Za-z0-9])whsec_[A-Za-z0-9]{16,}/g, REDACTED], // Stripe webhook signing secret
  [/(?<![A-Za-z0-9])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  // GitLab: personal, deploy, pipeline-trigger, runner, CI-build, OAuth-app, feed, and agent tokens.
  [/(?<![A-Za-z0-9])(?:glpat|gldt|glptt|glrt|glcbt|gloas|glsoat|glft|glimt|glagent)-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/(?<![A-Za-z0-9])GR1348941[A-Za-z0-9_-]{20,}/g, REDACTED], // GitLab runner registration token
  [/(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])pypi-[A-Za-z0-9_-]{50,}/g, REDACTED], // PyPI API token
  [/(?<![A-Za-z0-9])(?:hf|api_org)_[A-Za-z0-9]{30,}\b/g, REDACTED], // Hugging Face
  [/(?<![A-Za-z0-9])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, REDACTED], // SendGrid
  [/(?<![A-Za-z0-9-])key-[0-9A-Za-z]{32}(?![0-9A-Za-z])/g, REDACTED], // Mailgun private API key
  [/(?<![A-Za-z0-9])[0-9a-f]{32}-us[0-9]{1,2}(?![0-9A-Za-z])/g, REDACTED], // Mailchimp API key
  [/(?<![A-Za-z0-9])SK[0-9a-fA-F]{32}(?![0-9A-Za-z])/g, REDACTED], // Twilio API key SID
  [/(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, REDACTED], // AWS access key ids, long-term and temporary
  [/(?<![A-Za-z0-9])xox[abeoprs]-[A-Za-z0-9-]{10,}/g, REDACTED], // Slack tokens
  [/(?<![A-Za-z0-9])xapp-[0-9]-[A-Za-z0-9-]{10,}/g, REDACTED], // Slack app-level token
  [/(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}\b/g, REDACTED], // Google API key
  [/(?<![A-Za-z0-9])ya29\.[0-9A-Za-z_-]{20,}/g, REDACTED], // Google OAuth access token
  [/(?<![A-Za-z0-9])GOCSPX-[A-Za-z0-9_-]{20,}/g, REDACTED], // Google OAuth client secret
  [/(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED], // JWT
  [/(?<![A-Za-z0-9])sk\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED], // Mapbox secret token
  [/(?<![A-Za-z0-9])hv[sbr]\.[A-Za-z0-9_-]{24,}/g, REDACTED], // HashiCorp Vault service, batch, and recovery tokens
  [/(?<![A-Za-z0-9])[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_=-]{60,}/g, REDACTED], // Terraform Cloud / Enterprise
  [/(?<![A-Za-z0-9])do[opr]_v1_[a-f0-9]{64}(?![a-f0-9])/g, REDACTED], // DigitalOcean personal, OAuth, and refresh tokens
  [/(?<![A-Za-z0-9])lin_(?:api|oauth)_[A-Za-z0-9]{32,}/g, REDACTED], // Linear
  [/(?<![A-Za-z0-9])shp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}(?![0-9A-Za-z])/g, REDACTED], // Shopify
  [/(?<![A-Za-z0-9])sq0(?:atp|csp)-[A-Za-z0-9_-]{22,}/g, REDACTED], // Square
  [/(?<![A-Za-z0-9])dckr_pat_[A-Za-z0-9_-]{20,}/g, REDACTED], // Docker Hub
  [/(?<![A-Za-z0-9])PMAK-[a-f0-9]{24}-[a-f0-9]{34}/g, REDACTED], // Postman
  [/(?<![A-Za-z0-9])NR(?:AK|II|JS)-[A-Z0-9]{27}/g, REDACTED], // New Relic
  [/(?<![A-Za-z0-9])(?:ATATT3|ATBB)[A-Za-z0-9_=.-]{32,}/g, REDACTED], // Atlassian API token, Bitbucket app password
  [/(?<![A-Za-z0-9])dapi[a-f0-9]{32}(?:-[0-9])?(?![0-9A-Za-z])/g, REDACTED], // Databricks
  [/(?<![A-Za-z0-9])sntry[su]_[A-Za-z0-9+/=_-]{40,}/g, REDACTED], // Sentry auth tokens
  [/(?<![A-Za-z0-9])dp\.(?:st|pt|sa|ct|scrt|audit)\.[A-Za-z0-9_-]{40,}/g, REDACTED], // Doppler
  // Groq, Replicate, Perplexity, xAI, Supabase, Netlify, Fly, Figma, Grafana, Notion, Buildkite,
  // SonarQube, Pulumi, Shippo. A digit is required so that a hyphenated slug after `xai-` isn't one.
  [/(?<![A-Za-z0-9])(?:gsk_|r8_|pplx-|xai-|sbp_|nfp_|fo1_|figd_|glsa_|glc_|ntn_|bkua_|sq[pau]_|pul-|shippo_(?:live|test)_)(?=[A-Za-z0-9_-]{0,200}[0-9])[A-Za-z0-9_-]{30,}/g, REDACTED],
  [/(?<![A-Za-z0-9])secret_[A-Za-z0-9]{43}(?![A-Za-z0-9])/g, REDACTED], // Notion internal integration (older format)
  [/(?<![A-Za-z0-9])CFPAT-[A-Za-z0-9_-]{40,}/g, REDACTED], // Contentful
  [/(?<![A-Za-z0-9])dt0c01\.[A-Z0-9]{24}\.[A-Z0-9]{64}/g, REDACTED], // Dynatrace
  [/(?<![A-Za-z0-9])AKCp[A-Za-z0-9]{60,}/g, REDACTED], // JFrog Artifactory API key
  [/(?<![A-Za-z0-9])AGE-SECRET-KEY-1[0-9A-Z]{58}/g, REDACTED], // age encryption key
  [/(?<![A-Za-z0-9])access-(?:sandbox|development|production)-[a-f0-9]{8}-[a-f0-9-]{27}/g, REDACTED], // Plaid access token
  [/(?<![A-Za-z0-9])access_token\$(?:production|sandbox)\$[a-z0-9]{16}\$[a-f0-9]{32}/g, REDACTED], // Braintree / PayPal
  [/(?<![A-Za-z0-9])EAA(?=[A-Za-z0-9]{0,80}[0-9])(?=[A-Za-z0-9]{0,80}[a-z])[A-Za-z0-9]{80,}/g, REDACTED], // Facebook / Meta access token
  // Azure AD client secret: three characters, a digit, then "Q~".
  [/(?<![A-Za-z0-9_~.-])[A-Za-z0-9_.-]{3}[0-9]Q~[A-Za-z0-9_~.-]{31,34}(?![A-Za-z0-9_~.-])/g, REDACTED],
  // Telegram bot token (bot id, colon, 35-character secret) and Discord bot token (three dot-separated parts).
  [/(?<![0-9:])[0-9]{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, REDACTED],
  [/(?<![A-Za-z0-9_.-])(?=[A-Za-z0-9_-]{0,27}[0-9])[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}(?![A-Za-z0-9_.-])/g, REDACTED],
  // Webhook URLs are their own credential: anyone holding one can post.
  [/(\bhttps:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9/_-]+/g, `$1${REDACTED}`],
  [/(\bhttps:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/)[0-9]+\/[A-Za-z0-9_-]+/g, `$1${REDACTED}`],
  [/(\bhttps:\/\/[A-Za-z0-9-]{1,63}\.webhook\.office\.com\/webhookb2\/)[^\s"'<>]+/g, `$1${REDACTED}`],
  [/(\bhttps:\/\/hooks\.zapier\.com\/hooks\/catch\/)[0-9]+\/[A-Za-z0-9]+/g, `$1${REDACTED}`],
]

// URL query parameters that carry a credential under a name the assignment rule below doesn't
// read as one on its own: a signed URL's signature, an API key passed as `?key=`, a session id.
const QUERY_SECRET_NAMES = /^(?:sig|signature|x-amz-signature|x-goog-signature|key|sessionid|session_id|jwt)$/i

const POSITIONAL_PATTERNS: Rule[] = [
  // scheme://user:password@host — the password may itself contain "@", so it runs to the last one.
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/?#@"'<>]{1,256}:)[^\s/?#"'<>]{0,1024}(@)/gi, `$1${REDACTED}$2`],
  // scheme://token@host: a token alone where a user name goes (a Sentry DSN, a git remote with a token).
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/)([A-Za-z0-9_-]{20,256})(?=@)/gi, (match, scheme: string, user: string) => (/[0-9]/.test(user) && /[A-Za-z]/.test(user) ? `${scheme}${REDACTED}` : match)],
  // An Authorization header's credentials, whatever the scheme.
  [/(\b(?:Proxy-)?Authorization[ \t]*[:=][ \t]*["']?(?:(?:Bearer|Basic|Token|Digest|Bot)[ \t]+)?)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`],
  // mysql -u root -pS3cret (the password is glued to -p) and curl -u user:password.
  [/(\bmysql(?:dump|admin|import|sh)?\b[^\n]{0,200}?\s-p)(["']?)(?!\s)[^\s'"]+\2/g, `$1$2${REDACTED}$2`],
  [/(\bcurl\b[^\n]{0,500}?\s(?:-u|--user)[ \t=]+["']?[^\s:'"]{1,256}:)[^\s'"]+/g, `$1${REDACTED}`],
  // sshpass -p S3cret, redis-cli -a S3cret, docker login -p S3cret.
  [/(\b(?:sshpass\b[^\n]{0,100}?\s-p|redis-cli\b[^\n]{0,200}?\s-a|docker\s+login\b[^\n]{0,200}?\s-p)[ \t]*)(["']?)(?!-)[^\s'"]+\2/g, `$1$2${REDACTED}$2`],
  // A URL query parameter named in QUERY_SECRET_NAMES.
  [/([?&]([A-Za-z][A-Za-z0-9_-]{0,31})=)([^&#\s"'<>]{8,})/g, (match, head: string, name: string, value: string) =>
    QUERY_SECRET_NAMES.test(name) && !/^\d+$/.test(value) && !isMasked(value) && !PLACEHOLDER.test(value) ? `${head}${REDACTED}` : match],
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
// A name is at most 128 characters and taken whole (the lookahead and backreference make it
// atomic, so it's never re-tried shorter): unbounded, a long dotted run (`a.a.a.…`) was quadratic.
const ASSIGNMENT =
  /(\\?["']?)\b(?=([A-Za-z_][A-Za-z0-9_.-]{0,127}))\2\1([ \t]*(?:=>|:=|[:=])[ \t]*)(?:\\"((?:[^"\\\n]|\\[^"\n])*)\\"|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`\n]*)`|([^\s"'`,;&<>(){}[\]\\]+))/g

// How many labels deep the value of one that isn't a credential is searched for one that is:
// `Error: DB_PASSWORD=…` is one, `url=https://…?token=…` two. Bounded, so a run like `a:a:a:…`
// costs a fixed number of passes over itself, not one per label.
const MAX_LABEL_NESTING = 8

// The same in Japanese ("パスワード：…", "APIキー: …"). The value must be ASCII so that prose after
// the colon ("トークン：有効期限切れ") isn't masked along with it.
const JA_ASSIGNMENT = /((?:API|アクセス|シークレット)\s?キー|パスワード|パスフレーズ|シークレット|トークン|秘密鍵)(\s*[:=：]\s*)(["'「]?)([!#-&(-~]{8,})/gi

type CredentialKind = 'password' | 'token'

const PASSWORD_WORDS = new Set(['password', 'passwd', 'passwort', 'pwd', 'pw', 'pass', 'passphrase'])
const PASSWORD_SUFFIXES = ['password', 'passwd', 'passphrase']
const TOKEN_WORDS = new Set(['secret', 'token', 'apikey', 'credential', 'credentials', 'auth', 'cookie'])
const TOKEN_SUFFIXES = ['secret', 'token', 'apikey']
// "<qualifier> key" is a credential (api key, secret key, account key); a bare "key" usually isn't.
const KEY_QUALIFIERS = new Set(['api', 'access', 'secret', 'private', 'signing', 'encryption', 'master', 'account', 'shared', 'client', 'app', 'service', 'license', 'subscription', 'admin', 'auth', 'webhook', 'deploy', 'hmac', 'jwt', 'storage'])
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

/**
 * The assignment rule. A label that isn't a credential ("Error:", "env:", "https:") is matched
 * with the text after it as its value, but that value can still hold one (`Error: DB_PASSWORD=…`,
 * `https://…?token=…`, `out: password: …`), so the search goes on from where the value starts
 * rather than past it, up to MAX_LABEL_NESTING labels deep.
 */
function maskAssignments(text: string): string {
  const pattern = new RegExp(ASSIGNMENT.source, 'g')
  let out = ''
  let copied = 0
  // Where the values being searched inside end, innermost last.
  const open: number[] = []
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    const [match, quote, name, sep, escaped, dq, sq, bq, bare] = m
    const start = m.index
    const end = start + match.length
    while (open.length > 0 && open[open.length - 1] <= start) open.pop()
    const kind = credentialKind(name)
    const value = escaped ?? dq ?? sq ?? bq ?? bare ?? ''
    // Unquoted, a value may also be prose ("Token: expired yesterday"): see isMaskableValue.
    if (kind && isMaskableValue(value, kind, bare !== undefined, text[end])) {
      const masked =
        escaped !== undefined ? `\\"${REDACTED}\\"` : dq !== undefined ? `"${REDACTED}"` : sq !== undefined ? `'${REDACTED}'` : bq !== undefined ? `\`${REDACTED}\`` : REDACTED
      out += `${text.slice(copied, start)}${quote}${name}${quote}${sep}${masked}`
      copied = end
      continue
    }
    if (open.length < MAX_LABEL_NESTING) {
      open.push(end)
      pattern.lastIndex = start + quote.length * 2 + name.length + sep.length
    }
  }
  return out + text.slice(copied)
}

export function redactSecrets(text: string): string {
  let out = text
  for (const rule of TOKEN_PATTERNS) out = applyRule(out, rule)
  for (const rule of POSITIONAL_PATTERNS) out = applyRule(out, rule)
  out = out.replace(CARD_CANDIDATE, (match: string) => {
    if (looksLikeCardNumber(match)) return REDACTED
    // 4-4-4-4 followed by three more digits: a 19-digit card, or a 16-digit one and its CVC.
    const sixteen = /^(\d{4}([ -])\d{4}\2\d{4}\2\d{4})(\2\d{3})$/.exec(match)
    return sixteen && looksLikeCardNumber(sixteen[1]) ? `${REDACTED}${sixteen[3]}` : match
  })
  out = out.replace(AWS_SECRET_CANDIDATE, (match: string, offset: number, whole: string) =>
    looksLikeAwsSecret(match) && AWS_SECRET_CONTEXT.test(whole.slice(Math.max(0, offset - 100), offset)) ? REDACTED : match,
  )
  out = maskAssignments(out)
  out = out.replace(JA_ASSIGNMENT, (match, name, sep, quote, value) =>
    /^\d+$/.test(value) || isMasked(value) ? match : `${name}${sep}${quote}${REDACTED}`,
  )
  return out
}
