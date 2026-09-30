# Blind secret-masking corpus, Round 4

Lines for measuring `redactSecrets()` (`packages/core/src/redact.ts`) against tests its author
didn't design, written after the first corpus's holdout half ([`../blind-redact/`](../blind-redact/README.md))
was used up on 0.7.0. The fourth audit (`docs/audits/2026-09-30-audit-4-ja.md`) found unquoted
`.env` values with punctuation leaking, and over-masking of placeholders and versions; Round 4 asked
for a new blind corpus to measure the fixes honestly.

## Where the lines came from

On 2026-09-29 a separate agent, which had not seen `redact.ts`, its tests, the first corpus, or
anything else in the repository, was given only the spec below and wrote 266 items: 184 lines
containing secrets and 82 harmless look-alikes. It was told not to open any file on the machine,
and to generate every fake credential value with a random generator. Nobody edited the items
afterwards. None of the values is a real credential.

The spec, as given (the paths are the session's scratch directory):

> You are writing an independent, blind test corpus for a secret-masking ("redaction") function.
> The function takes one string (a line or small block of text from an AI coding agent's
> transcript: tool output, logs, configs, commands, error messages) and must replace credential
> VALUES with a placeholder, while leaving everything else unchanged.
>
> STRICT RULES (important, the whole point is independence):
> - Do NOT open, read, list, grep, or search ANY existing file on this machine — not the repository
>   in /home/user, not node_modules, not any other directory, nothing. Work only from your own
>   general knowledge of how secrets appear in real-world text.
> - You MAY use Bash/python/node only to (a) generate random characters for fake credential values
>   and (b) write your output file. Nothing else.
> - Every credential value must be FAKE: generate random characters in the correct
>   alphabet/length/prefix for that credential type. Never paste a real credential. Don't use
>   obviously patterned fillers like "abcd1234" or "xxxx" or "EXAMPLE"; values should look like real
>   randomly generated keys/passwords (use a random generator).
> - Write the result to exactly this path (and nothing else): …/scratchpad/blind2/corpus.raw.json
>
> WHAT TO WRITE:
> A JSON array of objects. Each object:
>   { "id": "<unique short id>", "kind": "secret" | "benign", "context": "<one of: log, config, env,
>   json, yaml, url, shell, stacktrace, ci, http, code, db, docker, other>", "text": "<the line or
>   small block, may contain \n>", "secrets": ["<exact substring(s) of text that must be hidden>"],
>   "note": "<few words: what it is>" }
> - For kind "secret": "secrets" lists every credential value in the text, each an exact substring
>   of "text" (just the value, not the key name). At least one.
> - For kind "benign": "secrets" is []. The whole text must be left completely unchanged by a
>   correct masker.
>
> QUANTITY: at least 120 "secret" items and at least 60 "benign" items.
>
> SECRET items — realistic and varied, the way secrets actually leak in practice:
> - At least 30 of them: UNQUOTED values in .env files, `export NAME=value` shell lines, docker
>   `-e NAME=value`, INI/properties files, or systemd `Environment=` lines, where the value is a
>   generated password or key that contains punctuation, as password generators and people really
>   produce them — for example characters such as ! # $ % & ( ) * + , - . / : ; < = > ? @ [ ] ^ _ { |
>   } ~ appearing anywhere in the value (start, middle, end). Vary the variable names (DB_PASSWORD,
>   SMTP_PASS, REDIS_AUTH, ADMIN_PWD, JWT_SECRET, STRIPE_KEY, APP_SECRET_KEY, etc. — invent your own
>   realistic ones too), vary spacing and separators (NAME=value, NAME = value, NAME: value in YAML),
>   and include some multi-line .env blocks with several variables where only some are secrets. The
>   "secrets" entry is the full value exactly as it appears.
> - Provider tokens with recognisable formats (cloud, source hosting, payment, chat/bot, email/SMS,
>   package registries, secrets managers, observability, CI, AI/LLM API keys, SaaS APIs).
> - Generic assignments in JSON / YAML / TOML / code (Python/JS/Go/Java/PHP) for things named like
>   password, secret, token, api key, client secret, private key.
> - Credentials inside URLs (connection-string userinfo, query parameters carrying
>   tokens/signatures, webhook URLs with a secret path).
> - HTTP headers and cookies, curl -H / -u, command-line flags like --password or -p.
> - Secrets embedded inside other text: log prefixes, timestamps, stack traces printing a config, CI
>   output, JSON nested in logs, JWTs, PEM private key blocks, base64 basic auth.
> - Mix languages/locales a little (e.g. a Japanese or German log message around a secret).
>
> BENIGN items — harmless look-alikes that a sloppy masker might wrongly change. Include at least 10
> of each of these groups, plus others:
> - placeholders and templated references in credential positions: `${DB_PASSWORD}`, `$API_TOKEN`,
>   `${SECRET:-default}`-style shell defaults, `{{ .Values.password }}`, `%(password)s`,
>   `<your-token-here>`, `process.env.SECRET_KEY`, `os.environ["PASSWORD"]`, `secrets.GITHUB_TOKEN`
>   in CI YAML, empty values;
> - version numbers and ranges, including package manifests and lockfile lines where the package
>   name itself contains a word like token, secret, auth, key or password (npm/pip/gem/cargo
>   dependency lines, `"^1.2.3"`, `~=2.0`, `>=3.1,<4`);
> - hashes and identifiers: git commit SHAs, checksums/integrity hashes, docker image digests, UUIDs
>   as request/trace ids;
> - also: token COUNTS ("max_tokens=4096"), names mentioned without a value, documentation
>   sentences about passwords, log lines like "password reset email sent" or "token expired",
>   harmless URL query parameters.
> Make them realistic and tricky, not trivially obvious.
>
> Keep each "text" to at most ~600 characters. Make sure the JSON is valid (validate it by parsing
> it with node or python after writing) and that every "secrets" entry is an exact substring of its
> "text". When done, reply with ONLY: the output path, the number of secret items, and the number
> of benign items. Do not paste any of the corpus content in your reply.

The spec names the shapes the fourth audit found (unquoted values with punctuation, `${…}`
placeholders, versions under a credential-like package name) because Round 4 set out to fix them;
it gives no example value, and the agent saw none of the fixes.

## The two halves

`scripts/split-blind-corpus.mjs` split the 266 items at random, stratified by kind, printing counts
only, before any of it was measured or read: `split.json` has the seed and the counts. The raw file
(sha256 `0c5a79d82ee36349e63866e448a583ba5e1eeb805c175db863596b3e54af95f5`) isn't committed; the
halves together are exactly its items, and the seed re-derives the split from it.

- `dev.json.b64`: 92 lines with secrets, 41 harmless. Used while fixing: measured on 0.7.0 first,
  then its misses were looked at, and the general shapes behind them were added to `redact.ts`
  (`src/redactBlind.test.ts` keeps it as a regression check, and lists the misses that remain).
- `holdout.json.b64`: 92 lines with secrets, 41 harmless. Not read by any test and not looked at.
  It is measured once, on the 0.7.1 release, rates only, and the output saved under
  `docs/audits/2026-09-30-round-4-results/`.

Both are base64-encoded JSON, so no provider-shaped fake credential sits in the repository as a
literal. `packages/core/test/blindCorpus.ts` decodes them, with the same measures as the first corpus.

## Measuring

```bash
node --experimental-strip-types scripts/redact-blind.ts dev --corpus 2             # the working tree
node --experimental-strip-types scripts/redact-blind.ts dev afecaba --corpus 2     # redact.ts at a commit
node --experimental-strip-types scripts/redact-blind.ts dev --corpus 2 --show      # and every miss (dev only)
node --experimental-strip-types scripts/redact-blind.ts holdout --corpus 2         # rates only, never lines
```
