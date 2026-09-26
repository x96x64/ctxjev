/**
 * 0.6.1's masking rules, kept so that nothing 0.6.1 masked is ever let through: `redactSecrets()`
 * applies these first and the current rules (redact.ts) to what's left, so a gap in a rewritten
 * rule can't reopen a leak 0.6.1 had closed. Rewriting rules for 0.7.0, independent reviews found
 * one such gap after another; running the old rules first ends that class of regression.
 *
 * The rules are 0.6.1's, with the same patterns and the same decisions, except where 0.6.1 took
 * time growing with the square of the input:
 * - an assignment's name is at most 128 characters and taken whole (a long dotted run `a.a.a…`
 *   took 24 seconds for 100,000 characters);
 * - a URL's scheme is at most 32 characters (from every word boundary in `a.a.a…`, 0.6.1 read the
 *   run to its end looking for `://`);
 * - a JWT is found by looking at each run of base64url characters once (maskJwts), with the same
 *   matches as 0.6.1's pattern;
 * - `mysql … -p…` and `curl … -u user:…` are found by a scan that visits each position once,
 *   instead of a pattern retried from every mention of the command to the end of its line, and
 *   curl's user name doesn't start with `=` (`curl -u====…` took quadratic time).
 * Each of the three bounds can change a result, on text no one writes: a name over 128 characters
 * isn't read as a credential's, a URL scheme over 32 characters isn't read as one, and a curl user
 * name starting with `=` isn't read as one (the newer rules in redact.ts still mask
 * `curl -u ==:…`). Four decisions differ from 0.6.1's, all listed in the CHANGELOG:
 * - a list of cookies (`sessionid=…; theme=dark`) under a name whose last word is "cookie" is left
 *   to the cookie rule in redact.ts, which masks every cookie that could hold a login. 0.6.1 masked
 *   the list's first cookie only, and that mask hid the rest of the list (`Cookie: sessionid="…"`
 *   became `Cookie: [REDACTED]"…"`) from the rules that run after it;
 * - a value that's the same name again, or a reference ending in it (`password=password`,
 *   `password=self.password`, `cookie = req.headers.cookie`), is code passing a variable on;
 * - a `--password`/`--token`/… value in angle brackets (`--password <password>`) is a usage line's
 *   placeholder;
 * - after a Japanese label, a Cookie, Set-Cookie, or Authorization header's name (`パスワード:
 *   Set-Cookie: sid=…`) isn't the value: 0.6.1 masked `Set-Cookie:`, and with it the header the
 *   cookie rule needs.
 */
const REDACTED = '[REDACTED]'

const isMasked = (value: string) => value.startsWith(REDACTED.slice(0, -1))

const TOKEN_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, REDACTED],
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/(?<![A-Za-z0-9])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED],
  [/(?<![A-Za-z0-9])whsec_[A-Za-z0-9]{16,}/g, REDACTED],
  [/(?<![A-Za-z0-9])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])glpat-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])hf_[A-Za-z0-9]{30,}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  [/(?<![A-Za-z0-9])ya29\.[0-9A-Za-z_-]{20,}/g, REDACTED],
]

// Applied after the JWT rule (maskJwts), in 0.6.1's order.
const TOKEN_PATTERNS_AFTER_JWT: Array<[RegExp, string]> = [
  [/(\bhttps:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9/_-]+/g, `$1${REDACTED}`],
  [/(\bhttps:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/)[0-9]+\/[A-Za-z0-9_-]+/g, `$1${REDACTED}`],
]

const POSITIONAL_PATTERNS: Array<[RegExp, string | ((match: string, ...groups: string[]) => string)]> = [
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/?#@"'<>]+:)[^\s/?#"'<>]*(@)/gi, `$1${REDACTED}$2`],
  [/(\b(?:Proxy-)?Authorization[ \t]*[:=][ \t]*["']?(?:(?:Bearer|Basic|Token|Digest|Bot)[ \t]+)?)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`],
  // A value in angle brackets is a usage line's placeholder (`--password <password>`), not a value.
  [/(\s--(?:password|passwd|token|secret|api[-_]?key|client[-_]secret|auth[-_]token)[ \t]+)(?!-)[^\s'"]+/gi, (match: string, head: string) => (/^<[^>]*>$/.test(match.slice(head.length)) ? match : `${head}${REDACTED}`)],
]

/**
 * 0.6.1's `mysql … -p…` and `curl … -u user:…` rules, `/(\bCOMMAND\b[^\n]*?ARGUMENT)/g`: for each
 * mention of the command (left to right, after the previous replacement), the first argument after
 * it that starts on the same line (its leading whitespace may be the line break). The next argument
 * match is found once and reused while later mentions come before it, so the scan is linear.
 */
function maskAfterCommand(text: string, command: RegExp, argument: RegExp, replace: (m: RegExpExecArray) => string): string {
  let out = ''
  let copied = 0
  let pos = 0
  let next: RegExpExecArray | null | undefined
  let nextFrom = -1
  let lineEnd = -1
  for (;;) {
    command.lastIndex = pos
    const c = command.exec(text)
    if (!c) break
    const from = c.index + c[0].length
    if (next === undefined || (next !== null && next.index < from) || (next === null && nextFrom > from)) {
      argument.lastIndex = from
      next = argument.exec(text)
      nextFrom = from
    }
    // Found once per line, not once per mention: many mentions on one long line stay linear.
    if (lineEnd !== text.length && lineEnd < c.index) {
      lineEnd = text.indexOf('\n', c.index)
      if (lineEnd < 0) lineEnd = text.length
    }
    if (next && next.index <= lineEnd) {
      out += text.slice(copied, next.index) + replace(next)
      copied = pos = next.index + next[0].length
      next = undefined
    } else {
      pos = c.index + 1
    }
  }
  return out + text.slice(copied)
}

/**
 * 0.6.1's JWT rule, `(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
 * with the same matches in linear time. As a pattern it restarted at every "eyJ" after `-` or `_`
 * and read to the end of the run each time (200,000 characters of `-eyJ` took 47 seconds). Since
 * none of its three parts can hold a `.`, each part is a whole run of base64url characters: a JWT is
 * three runs joined by single dots, the last two of 8 or more, starting at the first run's leftmost
 * "eyJ" that isn't preceded by a letter or digit and has 8 or more characters after it. Each run is
 * looked at once.
 */
export function maskJwts(text: string): string {
  if (!text.includes('eyJ')) return text
  const runs = [...text.matchAll(/[A-Za-z0-9_-]+/g)].map((m) => [m.index, m.index + m[0].length])
  let out = ''
  let copied = 0
  for (let i = 0; i + 2 < runs.length; i++) {
    const [s1, e1] = runs[i]
    const [s2, e2] = runs[i + 1]
    const [s3, e3] = runs[i + 2]
    if (s2 !== e1 + 1 || text[e1] !== '.' || s3 !== e2 + 1 || text[e2] !== '.' || e2 - s2 < 8 || e3 - s3 < 8) continue
    const first = text.slice(s1, e1)
    let at = -1
    for (let k = first.indexOf('eyJ'); k !== -1 && k + 11 <= first.length; k = first.indexOf('eyJ', k + 1)) {
      if (k === 0 || !/[A-Za-z0-9]/.test(first[k - 1])) {
        at = s1 + k
        break
      }
    }
    if (at < 0) continue
    out += text.slice(copied, at) + REDACTED
    copied = e3
    i += 2
  }
  return out + text.slice(copied)
}

const MYSQL = /\bmysql(?:dump|admin|import|sh)?\b/g
const MYSQL_ARGUMENT = /(\s-p)(["']?)(?!\s)[^\s'"]+\2/g
const CURL = /\bcurl\b/g
// The user name doesn't start with `=`: 0.6.1's `[ \t=]+` and user name could split a run of `=` any
// way at all, which took time growing with the square of its length.
const CURL_ARGUMENT = /(\s(?:-u|--user)[ \t=]+["']?(?!=)[^\s:'"]+:)[^\s'"]+/g

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

const AWS_SECRET_CANDIDATE = /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/g
const AWS_SECRET_CONTEXT = /aws|secret/i
const looksLikeAwsSecret = (value: string) => /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value)

// 0.6.1's pattern with the name taken whole and at most 128 characters (see the header).
const ASSIGNMENT =
  /(\\?["']?)\b(?=([A-Za-z_][A-Za-z0-9_.-]{0,127}))\2\1([ \t]*(?:=>|:=|[:=])[ \t]*)(?:\\"((?:[^"\\\n]|\\[^"\n])*)\\"|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`\n]*)`|([^\s"'`,;&<>(){}[\]\\]+))/g

const JA_ASSIGNMENT = /((?:API|アクセス|シークレット)\s?キー|パスワード|パスフレーズ|シークレット|トークン|秘密鍵)(\s*[:=：]\s*)(["'「]?)([!#-&(-~]{8,})/gi

type CredentialKind = 'password' | 'token'

const PASSWORD_WORDS = new Set(['password', 'passwd', 'passwort', 'pwd', 'pw', 'pass', 'passphrase'])
const PASSWORD_SUFFIXES = ['password', 'passwd', 'passphrase']
const TOKEN_WORDS = new Set(['secret', 'token', 'apikey', 'credential', 'credentials', 'auth', 'cookie'])
const TOKEN_SUFFIXES = ['secret', 'token', 'apikey']
const KEY_QUALIFIERS = new Set(['api', 'access', 'secret', 'private', 'signing', 'encryption', 'master', 'account', 'shared', 'client', 'app', 'service', 'license', 'subscription', 'admin', 'auth', 'webhook', 'deploy'])
const TRAILING_WORDS = new Set(['base', 'value', 'b64', 'base64', 'plain', 'plaintext', 'raw'])

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter(Boolean)
}

const kindCache = new Map<string, CredentialKind | undefined>()
function credentialKind(name: string): CredentialKind | undefined {
  if (kindCache.has(name)) return kindCache.get(name)
  const kind = classifyName(name)
  if (kindCache.size >= 4096) kindCache.clear()
  kindCache.set(name, kind)
  return kind
}

function classifyName(name: string): CredentialKind | undefined {
  const words = nameWords(name)
  while (words.length > 1 && TRAILING_WORDS.has(words[words.length - 1])) words.pop()
  const last = words[words.length - 1]
  if (!last) return undefined
  if (PASSWORD_WORDS.has(last) || PASSWORD_SUFFIXES.some((s) => last.endsWith(s))) return 'password'
  if (TOKEN_WORDS.has(last) || TOKEN_SUFFIXES.some((s) => last.endsWith(s))) return 'token'
  if (last === 'key' && words.length > 1 && KEY_QUALIFIERS.has(words[words.length - 2])) return 'token'
  return undefined
}

const PLACEHOLDER =
  /^(?:true|false|null|nil|none|undefined|yes|no|on|off|required|optional|string|str|number|int|boolean|bool|\*+|x{3,}|\.{3}|…|<[^>]*>|\{\{.*\}\}|\$\{?[A-Za-z_]\w*\}?|%[A-Za-z_]\w*%?)$/i
const REFERENCE = /^(?:process\.env|os\.environ|import\.meta\.env|ENV\[|System\.getenv|getenv)/

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function isMaskableValue(value: string, kind: CredentialKind, bare: boolean, next: string | undefined, name: string): boolean {
  if (value.length === 0 || isMasked(value) || PLACEHOLDER.test(value) || REFERENCE.test(value)) return false
  if (bare && (next === '(' || next === '[')) return false
  if (bare && new RegExp(`^(?:[A-Za-z_][A-Za-z0-9_]*\\.)*${escapeRegExp(name)}$`).test(value)) return false
  if (value.includes('=') && nameWords(name).at(-1) === 'cookie') return false
  if (kind === 'password') return true
  if (/^\d+$/.test(value)) return false
  return !bare || value.length >= 8
}

/** 0.6.1's `redactSecrets()`, in linear time (see the header). */
export function redactLegacy(text: string): string {
  let out = text
  for (const [pattern, replacement] of TOKEN_PATTERNS) out = out.replace(pattern, replacement)
  out = maskJwts(out)
  for (const [pattern, replacement] of TOKEN_PATTERNS_AFTER_JWT) out = out.replace(pattern, replacement)
  // Each rule below is skipped when the text lacks what it needs to match (`://` for a URL, "aws" or
  // "secret" before an AWS key): the same result, one pass over the text fewer.
  for (const [pattern, replacement] of POSITIONAL_PATTERNS.slice(0, 3)) if (pattern !== POSITIONAL_PATTERNS[0][0] || out.includes('://')) out = out.replace(pattern, replacement as string)
  out = maskAfterCommand(out, MYSQL, MYSQL_ARGUMENT, (m) => `${m[1]}${m[2]}${REDACTED}${m[2]}`)
  out = maskAfterCommand(out, CURL, CURL_ARGUMENT, (m) => `${m[1]}${REDACTED}`)
  for (const [pattern, replacement] of POSITIONAL_PATTERNS.slice(3)) out = typeof replacement === 'string' ? out.replace(pattern, replacement) : out.replace(pattern, replacement)
  out = out.replace(CARD_CANDIDATE, (match: string) => {
    if (looksLikeCardNumber(match)) return REDACTED
    const sixteen = /^(\d{4}([ -])\d{4}\2\d{4}\2\d{4})(\2\d{3})$/.exec(match)
    return sixteen && looksLikeCardNumber(sixteen[1]) ? `${REDACTED}${sixteen[3]}` : match
  })
  if (AWS_SECRET_CONTEXT.test(out)) out = out.replace(AWS_SECRET_CANDIDATE, (match: string, offset: number, whole: string) =>
    looksLikeAwsSecret(match) && AWS_SECRET_CONTEXT.test(whole.slice(Math.max(0, offset - 100), offset)) ? REDACTED : match,
  )
  out = out.replace(ASSIGNMENT, (match: string, quote: string, name: string, sep: string, escaped: string | undefined, dq: string | undefined, sq: string | undefined, bq: string | undefined, bare: string | undefined, offset: number, whole: string) => {
    const kind = credentialKind(name)
    const value = escaped ?? dq ?? sq ?? bq ?? bare ?? ''
    if (!kind || !isMaskableValue(value, kind, bare !== undefined, whole[offset + match.length], name)) return match
    const masked =
      escaped !== undefined ? `\\"${REDACTED}\\"` : dq !== undefined ? `"${REDACTED}"` : sq !== undefined ? `'${REDACTED}'` : bq !== undefined ? `\`${REDACTED}\`` : REDACTED
    return `${quote}${name}${quote}${sep}${masked}`
  })
  // A header's name (`パスワード: Set-Cookie: sid=…`) isn't the value: masking it would hide the header.
  out = out.replace(JA_ASSIGNMENT, (match, name, sep, quote, value) => (/^\d+$/.test(value) || isMasked(value) || /^(?:(?:Set-)?Cookie|(?:Proxy-)?Authorization):$/i.test(value) ? match : `${name}${sep}${quote}${REDACTED}`))
  return out
}
