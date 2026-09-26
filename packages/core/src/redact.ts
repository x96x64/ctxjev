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
import { maskJwts, redactLegacy } from './redactLegacy.js'
const REDACTED = '[REDACTED]'

// A value that's already masked, possibly cut at its closing bracket by a value pattern below.
const isMasked = (value: string) => value.startsWith(REDACTED.slice(0, -1))

// A third element is text the rule can't match without: when it's absent the rule is skipped, which
// saves a pass over the whole text and changes nothing.
type Rule = [RegExp, string | ((match: string, ...groups: string[]) => string), string?]

const applyRule = (text: string, [pattern, replacement, needs]: Rule) =>
  needs !== undefined && !text.includes(needs) ? text : typeof replacement === 'string' ? text.replace(pattern, replacement) : text.replace(pattern, replacement)

/** [pattern, replacement]: `$1` keeps a prefix that isn't secret (a host, a header name). */
const TOKEN_PATTERNS: Rule[] = [
  // PEM (RSA, EC, OpenSSH, …) and PGP (`-----BEGIN PGP PRIVATE KEY BLOCK-----`) private keys.
  [/-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g, REDACTED],
  // A PEM private key that was base64-encoded again (a Kubernetes secret, a kubeconfig's
  // client-key-data): "-----BEGIN " and then "PRIVATE KEY" at any of its three alignments.
  [/LS0tLS1CRUdJTi[A-Za-z0-9+/]{0,60}?(?:UFJJVkFURSBLRV|SSVZBVEUgS0VZ|UklWQVRFIEtFW)[A-Za-z0-9+/=]*/g, REDACTED],
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
  [/(?<![A-Za-z0-9])[0-9a-f]{32}-us[0-9]{1,2}(?![0-9A-Za-z])/g, REDACTED, '-us'], // Mailchimp API key
  [/(?<![A-Za-z0-9])SK[0-9a-fA-F]{32}(?![0-9A-Za-z])/g, REDACTED], // Twilio API key SID
  [/(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, REDACTED], // AWS access key ids, long-term and temporary
  [/(?<![A-Za-z0-9])xox[abeoprs]-[A-Za-z0-9-]{10,}/g, REDACTED], // Slack tokens
  [/(?<![A-Za-z0-9])xapp-[0-9]-[A-Za-z0-9-]{10,}/g, REDACTED], // Slack app-level token
  [/(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}\b/g, REDACTED], // Google API key
  [/(?<![A-Za-z0-9])ya29\.[0-9A-Za-z_-]{20,}/g, REDACTED], // Google OAuth access token
  [/(?<![A-Za-z0-9])GOCSPX-[A-Za-z0-9_-]{20,}/g, REDACTED], // Google OAuth client secret
]

// Applied after JWTs (maskJwts in redactLegacy.ts, linear), in this order.
const TOKEN_PATTERNS_AFTER_JWT: Rule[] = [
  [/(?<![A-Za-z0-9])sk\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED], // Mapbox secret token
  [/(?<![A-Za-z0-9])hv[sbr]\.[A-Za-z0-9_-]{24,}/g, REDACTED], // HashiCorp Vault service, batch, and recovery tokens
  [/(?<![A-Za-z0-9.])s\.(?=[A-Za-z0-9]{0,23}[0-9])[A-Za-z0-9]{24}(?![A-Za-z0-9])/g, REDACTED], // Vault's older service token format
  [/(?<![A-Za-z0-9])[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_=-]{60,}/g, REDACTED, '.atlasv1.'], // Terraform Cloud / Enterprise
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
  [/(?<![A-Za-z0-9])dp\.(?:st|pt|sa|ct|scrt|audit)\.(?:[a-z0-9_-]{1,40}\.)?[A-Za-z0-9_-]{40,}/g, REDACTED], // Doppler (a service token names its environment)
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
// An OAuth authorization code (`?code=…`) is a credential until it's redeemed; short codes (a status,
// a country, a promotion) aren't one, so only a long value counts.
const QUERY_LONG_SECRET_NAMES = /^code$/i
// Cookies that hold a login: session ids, auth and remember-me tokens.
const SESSION_COOKIE = /^(?:.*sess(?:ion)?(?:[_-]?(?:id|key|token))?|sid|.*auth.*|.*token|jwt|remember.*|connect\.sid|__Secure-.*|__Host-.*|wordpress_(?:logged_in|sec)_.*|S?SESS[0-9a-f]{8,})$/i

// Code that reads a cookie rather than one: `req.headers.cookie`, `this.session.id`.
const CODE_REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/
// Cookies that never hold a login: analytics, consent, preferences, and Set-Cookie's attributes
// (`HttpOnly` and `Secure` have no value).
const PLAIN_COOKIE = /^(?:_ga.*|_gid|_gat.*|_gcl_.*|_fbp|_fbc|_hj.*|_pk_.*|_clck|_clsk|ajs_.*|mp_.*|amplitude.*|optimizely.*|theme|lang|language|locale|tz|timezone|currency|country|region|.*consent.*|OptanonConsent|OptanonAlertBoxClosed|dark_?mode|path|domain|expires|max-age|samesite|secure|httponly|priority|partitioned|version|comment)$/i

/**
 * A cookie string (a `Cookie:` header's value, `document.cookie`'s, a variable holding one) with
 * every cookie's value masked except those of known analytics, consent, and preference cookies and
 * Set-Cookie's attributes, which stay readable, and a value that's a plain word under a name that
 * doesn't say it's a session or a credential (or one under 8 characters). A part with no name
 * (`Cookie: <token>`) is masked if it's a token. Placeholders and code (`req.headers.cookie`) are
 * left alone.
 */
function maskCookies(cookies: string): string {
  return cookies
    .split(/(;[ \t]*)/)
    .map((part, i) => (i % 2 === 1 ? part : maskCookie(part)))
    .join('')
}

// A value never takes a parenthesis, angle bracket, or comma (`(Cookie: sessionid=…)` in prose).
const COOKIE_PAIR = /^([ \t]*)([^\s=;"'\\(),<>]{1,128})=(\\?["']?)((?:[^\s;"'\\(),<>]|\\\S){0,4096})/
// A part with no name is one word, and never a label (`DB_PASSWORD:`, `accessToken =`) or a flag
// (`--password`): those, after a cookie, are left to the rules for them.
const COOKIE_WORD = /^([ \t]*)(?!-)((?:[^\s;"'\\(),<>]|\\\S){8,4096})(?<!:)(?![ \t]*[:=])(?=\s|$)/

// What follows a masked value, less the rest of the value if the pattern's length limit cut it
// short (a value of more than 4,096 characters is masked whole, in one pass).
const afterValue = (rest: string) => rest.slice(/^(?:[^\s;"'\\(),<>]|\\\S)*/.exec(rest)![0].length)

function maskCookie(part: string): string {
  const pair = COOKIE_PAIR.exec(part)
  // A value that starts with `=` is a base64 token's padding (`Zq8…Pab==`), not a name and a value.
  if (pair && pair[4].length > 0 && pair[4][0] !== '=') {
    const [whole, space, name, quote, value] = pair
    // One named like a session or a credential is masked whatever it holds; any other when it looks
    // like a token (`uid=a8f3k2m9x1`), not a word (`cookie_consent=necessary`).
    const named = SESSION_COOKIE.test(name) || credentialKind(name) !== undefined
    if (PLAIN_COOKIE.test(name) || isMasked(value)) return part
    // A name with a random part (letters and digits, 8 or more: `Qw7Er9Ty3Ui5=…`, `SSESS4f2a…`) may
    // be a token glued to what follows rather than a name, so the whole pair is masked.
    if (name.length >= 8 && /[0-9]/.test(name) && /[A-Za-z]/.test(name)) return `${space}${REDACTED}${afterValue(part.slice(whole.length))}`
    // A session's value is masked whatever it looks like (Jetty's `node0….node0` reads like code).
    if (!named && (value.length < 8 || !looksLikeToken(value) || PLACEHOLDER.test(value) || CODE_REFERENCE.test(value))) return part
    return `${space}${name}=${quote}${REDACTED}${afterValue(part.slice(whole.length))}`
  }
  // No name, or nothing after `=` (a base64 token's padding: `dGhpc…=`).
  const word = COOKIE_WORD.exec(part)
  if (!word) return part
  const [whole, space, value] = word
  // Not a call (`= getCookie()`).
  if (part[whole.length] === '(' || PLAIN_COOKIE.test(value) || !looksLikeToken(value) || isMasked(value) || PLACEHOLDER.test(value) || CODE_REFERENCE.test(value)) return part
  return `${space}${REDACTED}${part.slice(whole.length)}`
}

// .netrc: `password <value>` (on a line of its own or after machine/login), only in text that has a
// `machine` entry (checked once, not per match), so prose like "password must be 12 characters"
// isn't touched.
// The hint needs an entry's shape (`machine <host> login …`, `default login …`), and the value must
// end the line or come before another keyword: "state machine enters login" followed by "password
// prompt shown twice" is prose.
// Comment lines are removed before the hint is tested (a `# prod` line between `machine` and
// `login`); a pattern that skipped them itself was ambiguous about trailing whitespace, and took
// exponential time on a block of comment lines.
const NETRC_HINT = /(?:^|\s)(?:machine[ \t]+\S{1,253}|default)[ \t\r\n]+(?:login|account|password)[ \t]+\S/
const NETRC_COMMENT_LINE = /^[ \t]*#[^\n]*\n/gm
const NETRC_PASSWORD = /(^[ \t]*(?:(?:machine|login|account)[ \t]+\S+[ \t]+|default[ \t]+)*password[ \t]+)("[^"\n]{1,256}"|\S+)(?=[ \t\r]*$|[ \t]+(?:machine|login|account|macdef|default|port)[ \t]|[ \t]+#)/gm

// Cookie / Set-Cookie headers and document.cookie, bare or quoted (`"Cookie": "…"`, `{'Cookie':
// '…'}`, `=>`, escaped JSON), each value passed to maskCookies. A quoted value ends at its closing
// quote; a bare one at a double quote (except one opening a cookie's value, `sessionid="…"`), a
// backtick, or the next Cookie header on the line.
const COOKIE_RULE: Rule = [/(\b(?:Set-)?Cookie(?:\\?["'`])?[ \t]*(?:=>|:=|[:=])[ \t]*)(?:\\"((?:[^"\\\r\n]|\\[^"\r\n]){1,8192})\\"|"((?:[^"\\\r\n]|\\.){1,8192})"|'((?:[^'\\\r\n]|\\.){1,8192})'|`([^`\r\n]{1,8192})`|((?:(?!\b(?:Set-)?Cookie(?:\\?["'`])?[ \t]*(?:=>|:=|[:=]))(?:[^\r\n"`=]|="[^"\r\n]{0,4096}"|=)){1,8192}))/gi,
  (_match, head: string, escaped?: string, dq?: string, sq?: string, bq?: string, bare?: string) =>
    escaped !== undefined ? `${head}\\"${maskCookies(escaped)}\\"` : dq !== undefined ? `${head}"${maskCookies(dq)}"` : sq !== undefined ? `${head}'${maskCookies(sq)}'` : bq !== undefined ? `${head}\`${maskCookies(bq)}\`` : head + maskCookies(bare ?? '')]

const POSITIONAL_PATTERNS: Rule[] = [
  // scheme://user:password@host — the password may itself contain "@", so it runs to the last one.
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/?#@"'<>]{0,256}:)[^\s/?#"'<>]{1,1024}(@)/gi, `$1${REDACTED}$2`, '://'],
  // scheme://token@host: a token alone where a user name goes (a Sentry DSN, a git remote with a token).
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/)([A-Za-z0-9_-]{20,256})(?=@)/gi, (match, scheme: string, user: string) => (/[0-9]/.test(user) && /[A-Za-z]/.test(user) ? `${scheme}${REDACTED}` : match), '://'],
  // An Authorization header's credentials, whatever the scheme.
  // A known scheme's credentials are masked whatever they look like (`Basic dXNlcjpwYXNz` is all
  // letters); after any other word only what looks like a token, so "Authorization: missing
  // credentials" stays as it is. The value is taken whole, and never the name of another header
  // (`authorization=a1b… Authorization: b1b…`), which would hide that header from the next match,
  // or a flag (`use --api-key …`). It's at most 4,096 characters: unbounded, a run of joined labels
  // (`Authorization=Authorization=…`) was read to its end from every label, in quadratic time.
  [/(\b(?:Proxy-)?Authorization(?:\\?["'])?[ \t]*(?:=>|:=|[:=])[ \t]*(?:\\?["'])?)(?:([A-Za-z][A-Za-z0-9-]{1,30})([ \t]+))?(?!-)(?=([A-Za-z0-9._~+/=-]{8,4096}))\4(?!:\s)/gi, (match: string, head: string, scheme: string | undefined, space: string, value: string) =>
    {
      // With no word before it, the value may be the scheme itself, its credentials already masked.
      if (scheme === undefined) return looksLikeToken(value) && !AUTH_SCHEMES.test(value) ? `${head}${REDACTED}` : match
      if (AUTH_SCHEMES.test(scheme)) return `${head}${scheme}${space}${REDACTED}`
      // A first word that isn't a scheme may be the token itself, with more of the line after it
      // (`authorization=a1b2… path=/v1`, `Authorization: a1b2… HTTP/1.1`).
      if (scheme.length >= 8 && looksLikeToken(scheme)) return `${head}${REDACTED}${space}${value}`
      return looksLikeToken(value) ? `${head}${scheme}${space}${REDACTED}` : match
    }],
  // An AWS Signature Version 4 signature (in an Authorization header, after its credential scope).
  [/(\bSignature=)[0-9a-f]{64}\b/g, `$1${REDACTED}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`],
  // Before the flag rule, so `--token "Cookie": "…"` can't take the header's name for a value.
  COOKIE_RULE,
  // --password S3cret, --token abc…, --db-password …, --client-secret …: a separate argument after a
  // flag named like a credential (the same words as an assignment's name; `--token-file x` isn't one).
  // The value is taken whole (so `--db-password hunter22 :x` can't give back its last character),
  // and a quoted value is never a JSON key (`--token "password": "…"`).
  [/(\s--([A-Za-z][A-Za-z0-9_-]{0,63})[ \t]+)(["']?)(?!-)(?=([^\s'"]+))\4\3(?!(?<=["'])[ \t]*:)/g, (match, head: string, flag: string, quote: string, value: string) => {
    const kind = credentialKind(flag)
    if (kind === 'cookie') return `${head}${quote}${maskCookies(value)}${quote}`
    return kind && isMaskableFlagValue(value, kind) ? `${head}${quote}${REDACTED}${quote}` : match
  }],
  // SQL: CREATE ROLE … PASSWORD '…', CREATE USER … IDENTIFIED BY '…', and the same in prose.
  // A value with spaces only after an upper-case keyword, as SQL writes it: `"Enter password " +
  // user` and `the password "is too short"` aren't one.
  // Never a quoted key (`password "password": "…"`): the assignment rule masks that key's value.
  [/(\b(?:PASSWORD|PASSWD|IDENTIFIED\s+BY)\s+)(['"])([^'"\n]{1,256})\2(?![ \t]*:)/gi, (match, head: string, quote: string, value: string) =>
    isMasked(value) || (/\s/.test(value) && !/^(?:PASSWORD|PASSWD|IDENTIFIED)/.test(head)) ? match : `${head}${quote}${REDACTED}${quote}`],
  // A user name and password passed to a credential constructor: NetworkCredential("u", "p"),
  // HTTPBasicAuth('u', 'p'), UsernamePasswordCredentials("u", "p"), requests' auth=('u', 'p').
  [/(\b(?:NetworkCredential|UsernamePasswordCredentials|PasswordAuthentication|HTTPBasicAuth|HTTPDigestAuth|BasicAuth|basicAuth|auth\s*=\s*)\(\s*(["'])[^"'\n]{0,128}\2\s*,\s*)(["'])([^"'\n]{1,256})\3/g, `$1$3${REDACTED}$3`],
  // ~/.pgpass: hostname:port:database:username:password, one per line. The port is a server's (1000
  // and up, or `*`), and the host is a name or a socket directory (`/var/run/postgresql`), not a
  // relative path, so `12:30:45:123:4567` and grep's `file:3:…` aren't one.
  [/^((?:\/[^:\s#]{0,252}|[^:\s#/]{1,253}):(?:[1-9][0-9]{3,4}|\*):[^:\s]{1,128}:[^:\s]{1,128}:)(\S+)$/gm, (match, head: string, value: string) => (isMasked(value) || PLACEHOLDER.test(value) ? match : `${head}${REDACTED}`)],
  // A Kubernetes (or compose) env var over two lines: `- name: DB_PASSWORD` then `value: …`.
  [/(\bname:[ \t]*(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,127})\2[ \t]*\r?\n[ \t]*value:[ \t]*)(["']?)([^\s"']{1,1024})\4/g, (match, head: string, _q: string, name: string, quote: string, value: string) => {
    const kind = credentialKind(name)
    return kind && isMaskableValue(value, kind, quote === '', undefined, name) && (kind === 'password' || looksLikeToken(value)) ? `${head}${quote}${REDACTED}${quote}` : match
  }],
  // XML and .NET config: <password>…</password>, <add key="ApiKey" value="…"/>.
  [/(<([A-Za-z_][A-Za-z0-9_.:-]{0,63})>)([^<\n]{1,1024})(<\/\2>)/g, (match, open: string, name: string, value: string, close: string) => {
    const kind = credentialKind(name)
    return kind && isMaskableValue(value, kind, false, undefined) && (kind === 'password' || !CAPITALIZED_WORD.test(value)) ? `${open}${REDACTED}${close}` : match
  }],
  [/(\bkey\s*=\s*"([^"\n]{1,128})"\s+value\s*=\s*")([^"\n]{1,1024})"/gi, (match, head: string, name: string, value: string) => {
    const kind = credentialKind(name)
    return kind && isMaskableValue(value, kind, false, undefined) && (kind === 'password' || !CAPITALIZED_WORD.test(value)) ? `${head}${REDACTED}"` : match
  }],
  // A URL query parameter named in QUERY_SECRET_NAMES.
  // `?key=` holding a path or a file name (`reports/2026/q3.csv`) is an object key, not an API key.
  [/([?&]([A-Za-z][A-Za-z0-9_-]{0,31})=)([^&#\s"'<>]{8,})/g, (match, head: string, name: string, value: string) =>
    ((QUERY_SECRET_NAMES.test(name) && !(/^key$/i.test(name) && /\/|\.[A-Za-z]{2,5}$/.test(value))) || (QUERY_LONG_SECRET_NAMES.test(name) && value.length >= 16)) && !/^\d+$/.test(value) && !isMasked(value) && !PLACEHOLDER.test(value) ? `${head}${REDACTED}` : match],
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

// `longToken`: a name that's as often a setting's as a secret's (`STORAGE_KEY = "todos-v1"` next to
// `AZURE_STORAGE_KEY=<88 characters of base64>`), so only a long value counts.
// `cookie`: a name ending in "cookie" that doesn't say what it holds (COOKIE=…, MY_COOKIE=…,
// rawCookie = "…"): its value is read as a cookie string (see maskCookies).
type CredentialKind = 'password' | 'token' | 'longToken' | 'cookie'

const PASSWORD_WORDS = new Set(['password', 'passwd', 'passwort', 'pwd', 'pw', 'pass', 'passphrase'])
const PASSWORD_SUFFIXES = ['password', 'passwd', 'passphrase']
const TOKEN_WORDS = new Set(['secret', 'token', 'apikey', 'credential', 'credentials', 'auth'])
const TOKEN_SUFFIXES = ['secret', 'token', 'apikey']
// "<qualifier> key" is a credential (api key, secret key, account key); a bare "key" usually isn't.
const KEY_QUALIFIERS = new Set(['api', 'access', 'secret', 'private', 'signing', 'encryption', 'master', 'account', 'shared', 'client', 'app', 'service', 'license', 'subscription', 'admin', 'auth', 'webhook', 'deploy', 'hmac', 'jwt'])
const LONG_KEY_QUALIFIERS = new Set(['storage'])
// "<qualifier> cookie" holds a login (AUTH_COOKIE, SESSION_COOKIE); a bare "cookie" is a header name.
const COOKIE_QUALIFIERS = new Set(['session', 'sess', 'auth', 'login', 'remember', 'access', 'refresh', 'sso', 'jwt'])
// Words that can follow the credential without changing what it is: SECRET_KEY_BASE, token_value.
const TRAILING_WORDS = new Set(['base', 'value', 'b64', 'base64', 'plain', 'plaintext', 'raw', 'data'])

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
// Names repeat (every `x=` in a log is read once per pass), so each is classified once.
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
  if (last === 'key' && words.length > 1 && LONG_KEY_QUALIFIERS.has(words[words.length - 2])) return 'longToken'
  if (last === 'cookie') return words.length > 1 && COOKIE_QUALIFIERS.has(words[words.length - 2]) ? 'token' : 'cookie'
  return undefined
}

// Not a secret: a type, a placeholder, a reference to where the secret actually lives.
const PLACEHOLDER =
  /^(?:true|false|null|nil|none|undefined|yes|no|on|off|required|optional|string|str|number|int|boolean|bool|\*+|x{3,}|\.{3}|…|<[^>]*>|\{\{.*\}\}|\$\{?[A-Za-z_]\w*\}?|%[A-Za-z_]\w*%?)$/i
const REFERENCE = /^(?:process\.env|os\.environ|import\.meta\.env|ENV\[|System\.getenv|getenv)/

/** `next` is the character right after the value: an unquoted value followed by `(` or `[` is code (`token = get_token()`). */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function isMaskableValue(value: string, kind: CredentialKind, bare: boolean, next: string | undefined, name?: string): boolean {
  if (value.length === 0 || isMasked(value) || PLACEHOLDER.test(value) || REFERENCE.test(value)) return false
  if (bare && (next === '(' || next === '[')) return false
  // Code passing a variable on: `password=password`, `token=self.token`.
  if (bare && name !== undefined && new RegExp(`^(?:[A-Za-z_][A-Za-z0-9_]*\\.)*${escapeRegExp(name)}$`).test(value)) return false
  if (kind === 'password') return true
  if (kind === 'longToken') return value.length >= 20 && !/\s/.test(value)
  if (kind === 'cookie') return maskCookies(value) !== value
  // A purely numeric value (MAX_TOKENS=100000) is a setting, not a secret.
  if (/^\d+$/.test(value)) return false
  return !bare || value.length >= 8
}

/**
 * A credential given as a separate argument (`--token abcdef`, `--api-key 12345678901234`): masked
 * unless it's a placeholder or a reference, or an authentication scheme's name after a token-named
 * flag (`--auth basic`), which is a mode rather than a secret.
 */
function isMaskableFlagValue(value: string, kind: CredentialKind): boolean {
  if (isMasked(value) || PLACEHOLDER.test(value) || REFERENCE.test(value)) return false
  if (kind === 'longToken') return value.length >= 20
  return kind === 'password' || !AUTH_SCHEMES.test(value)
}

/**
 * Whether a value that could be a word is a token: a digit or a symbol in it, a capital after its
 * first letter (base64: `dXNlcjpwYXNz`), or 16 characters or more. "credentials", "disabled",
 * and anything with a space in it aren't.
 */
const looksLikeToken = (value: string) => !/\s/.test(value) && (/[^A-Za-z]/.test(value) || /.[A-Z]/.test(value) || value.length >= 16)
// One capitalized word (`<Token>Identifier</Token>`, `<ApiKey>Required</ApiKey>`): a label, not a value.
const CAPITALIZED_WORD = /^[A-Z][a-z]{1,15}$/

// Authorization schemes whose credentials are masked whatever they look like.
const AUTH_SCHEMES = /^(?:Basic|Bearer|Bot|Digest|Token|SSWS|OAuth|Negotiate|NTLM|Kerberos|HOBA|Mutual|ApiKey|Key|Signature|SharedKey|SharedAccessSignature|AWS4-HMAC-SHA256|GoogleLogin|Splunk|Klaviyo-API-Key|DeepL-Auth-Key|MAC|JWT|Hawk)$/i

// A password given to a command as an argument: `mysql -u root -pS3cret`, `curl -u user:pass`,
// `sshpass -p …`, `redis-cli -a …`, `docker login -p …`, `az login -p …`, `sqlcmd -P …`, quoted
// or not. The first such argument after each mention of the command, as far as the command goes
// (see commandEnd). Found command by command, not by one pattern with a gap in it, so a long command
// has no length limit and many mentions cost no more than one. Each argument pattern names the
// value `q` (quoted) or `v` (bare). The third element says whether the command ends at a `;`, `|`,
// `&&`, or `||`: for mysql and curl it doesn't, as in 0.6.1 (the password is the first `-p` or
// `-u user:` anywhere after it on the line); for the rest, whose flags other commands use too
// (`docker run -p 8080:80`), it does.
const QUOTED = `(["'])(?<q>[^\\n]{1,256}?)\\1`
const COMMAND_ARGUMENTS: Array<[RegExp, RegExp, boolean]> = [
  [/\bmysql(?:dump|admin|import|sh)?\b/g, new RegExp(`\\s-p(?:${QUOTED}|(?<v>[^\\s'"]+))`, 'd'), false],
  [/\bcurl\b/g, /\s(?:-u[ \t=]*|--user[ \t=]+)(?:(["'])[^\s:'"]{0,256}:(?<q>[^\n]{1,256}?)\1|(?:[^\s:'"=-][^\s:'"]{0,255})?:(?<v>[^\s'"]+))/d, false],
  [/\bsshpass\b/g, new RegExp(`\\s-p[ \\t]*(?:${QUOTED}|(?<v>(?!-)[^\\s'"]+))`, 'd'), true],
  [/\bredis-cli\b/g, new RegExp(`\\s-a[ \\t]*(?:${QUOTED}|(?<v>(?!-)[^\\s'"]+))`, 'd'), true],
  [/\bdocker[ \t]+login\b/g, new RegExp(`\\s-p[ \\t]*(?:${QUOTED}|(?<v>(?!-)[^\\s'"]+))`, 'd'), true],
  [/\baz[ \t]+login\b/g, new RegExp(`\\s-p[ \\t]+(?:${QUOTED}|(?<v>(?!-)[^\\s'"]+))`, 'd'), true],
  [/\bsqlcmd\b/g, new RegExp(`\\s-P[ \\t]*(?:${QUOTED}|(?<v>(?!-)[^\\s'"]+))`, 'd'), true],
]

/**
 * Where the command mentioned at `from` ends, looking no further than `limit`: a line break that
 * isn't a `\` continuation (`\` then LF or CRLF), and with `atSeparators`, a `&&`, `||`, `|`, or
 * `;` outside quotes (`-H "Accept: a; q=0.9"` and `-p'Xy7;k'` don't end one). Quotes are tracked
 * from the command itself, so an apostrophe earlier on the line ("Let's run: …") doesn't count.
 */
function commandEnd(text: string, from: number, limit: number, atSeparators: boolean): number {
  let quote: string | undefined
  for (let i = from; i < limit; i++) {
    const c = text[i]
    if (c === '\n') {
      if (text[i - 1] !== '\\' && !(text[i - 1] === '\r' && text[i - 2] === '\\')) return i
    } else if (!atSeparators) {
      continue
    } else if (quote !== undefined) {
      if (c === quote && text[i - 1] !== '\\') quote = undefined
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === ';' || c === '|' || (c === '&' && text[i + 1] === '&')) {
      return i
    }
  }
  return limit
}

function maskCommandArguments(text: string): string {
  // Every edit is found on the text as given and applied once at the end, so masking one command's
  // password (which changes the text's length) can't move where another command ends.
  const edits: Array<[number, number]> = []
  for (const [command, argument, atSeparators] of COMMAND_ARGUMENTS) {
    const starts = [...text.matchAll(command)].map((m) => m.index)
    // Each mention is scanned only up to the next one, so the scans together cover the text once.
    starts.forEach((start, i) => {
      const end = commandEnd(text, start, starts[i + 1] ?? text.length, atSeparators)
      const m = argument.exec(text.slice(start, end))
      const at = m?.indices?.groups?.q ?? m?.indices?.groups?.v
      if (at && !isMasked(text.slice(start + at[0], start + at[1]))) edits.push([start + at[0], start + at[1]])
    })
  }
  if (edits.length === 0) return text
  edits.sort((a, b) => a[0] - b[0])
  let out = ''
  let copied = 0
  for (const [from, to] of edits) {
    if (from < copied) continue
    out += text.slice(copied, from) + REDACTED
    copied = to
  }
  return out + text.slice(copied)
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
    if (kind && isMaskableValue(value, kind, bare !== undefined, text[end], name)) {
      // A cookie string keeps its plain cookies readable (see maskCookies).
      const inner = kind === 'cookie' ? maskCookies(value) : REDACTED
      const masked = escaped !== undefined ? `\\"${inner}\\"` : dq !== undefined ? `"${inner}"` : sq !== undefined ? `'${inner}'` : bq !== undefined ? `\`${inner}\`` : inner
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

/**
 * Masks what 0.6.1 masked (redactLegacy.ts), then what these rules mask, and repeats until nothing
 * changes (at most a few passes; one is almost always enough), so masking twice is the same as once.
 * Running 0.6.1's rules first means a gap in a rule rewritten here can't let through a secret 0.6.1
 * caught; it also keeps 0.6.1's false alarms (see the CHANGELOG).
 */
export function redactSecrets(text: string): string {
  let out = text
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = redactCurrent(redactLegacy(out))
    if (next === out) break
    out = next
  }
  return out
}

const MAX_PASSES = 4

function redactCurrent(text: string): string {
  let out = text
  for (const rule of TOKEN_PATTERNS) out = applyRule(out, rule)
  out = maskJwts(out)
  for (const rule of TOKEN_PATTERNS_AFTER_JWT) out = applyRule(out, rule)
  // Before the positional rules, so a flag's rule can't take the command's name for its value
  // (`--token curl -u admin:…`).
  out = maskCommandArguments(out)
  for (const rule of POSITIONAL_PATTERNS) out = applyRule(out, rule)
  if (/\b(?:machine|default)\b/.test(out) && NETRC_HINT.test(out.replace(NETRC_COMMENT_LINE, ''))) out = out.replace(NETRC_PASSWORD, (match, head: string, value: string) => (isMasked(value) ? match : `${head}${REDACTED}`))
  out = out.replace(CARD_CANDIDATE, (match: string) => {
    if (looksLikeCardNumber(match)) return REDACTED
    // 4-4-4-4 followed by three more digits: a 19-digit card, or a 16-digit one and its CVC.
    const sixteen = /^(\d{4}([ -])\d{4}\2\d{4}\2\d{4})(\2\d{3})$/.exec(match)
    return sixteen && looksLikeCardNumber(sixteen[1]) ? `${REDACTED}${sixteen[3]}` : match
  })
  // Skipped when "aws" and "secret" appear nowhere: the rule needs one of them before the key.
  if (AWS_SECRET_CONTEXT.test(out)) out = out.replace(AWS_SECRET_CANDIDATE, (match: string, offset: number, whole: string) =>
    looksLikeAwsSecret(match) && AWS_SECRET_CONTEXT.test(whole.slice(Math.max(0, offset - 100), offset)) ? REDACTED : match,
  )
  out = maskAssignments(out)
  out = out.replace(JA_ASSIGNMENT, (match, name, sep, quote, value) =>
    /^\d+$/.test(value) || isMasked(value) ? match : `${name}${sep}${quote}${REDACTED}`,
  )
  return out
}
