# Blind secret-masking corpus, Round 5

Lines for measuring `redactSecrets()` (`packages/core/src/redact.ts`) against tests its author
didn't design, written after the second corpus's holdout half ([`../blind-redact-2/`](../blind-redact-2/README.md))
was used up on 0.7.1. The fifth audit (`docs/audits/2026-10-01-audit-5-ja.md`) found URL passwords
holding `#`, `/`, or `?`, passphrases with spaces, and non-ASCII values after a Japanese label
leaking; Round 5 asked for a new blind corpus to measure the fixes honestly.

## Where the lines came from

On 2026-09-30 a separate agent, which had not seen `redact.ts`, its tests, the earlier corpora, or
anything else in the repository, was given only the spec below and wrote 397 items: 237 lines
containing secrets and 160 harmless look-alikes. It was told not to open any file on the machine,
and to generate every fake credential value with a random generator. Nobody edited the items
afterwards, and nobody read them before the split. None of the values is a real credential.

The spec, as given (the path is the session's scratch directory):

> You are writing an independent, blind test corpus for a secret-masking ("redaction") function.
> The function takes one string (a line or small block of text from an AI coding agent's
> transcript: tool output, logs, configs, commands, error messages, chat) and must replace
> credential VALUES with a placeholder, while leaving everything else unchanged.
>
> STRICT RULES (important, the whole point is independence):
> - Do NOT open, read, list, grep, or search ANY existing file on this machine — not the repository
>   in /home/user, not node_modules, not any other directory, nothing. Work only from your own
>   general knowledge of how secrets appear in real-world text.
> - You MAY use Bash/python/node only to (a) generate random characters for fake credential values
>   and (b) write your output file. Nothing else.
> - Every credential value must be FAKE: generate random characters in the correct
>   alphabet/length/prefix for that credential type. Never paste a real credential. Don't use
>   obviously patterned fillers like "abcd1234", "xxxx", "EXAMPLE", "changeme"; values should look
>   like real randomly generated keys/passwords (use a random generator). For passphrases, pick
>   random dictionary-like words with a random generator.
> - Write the result to exactly this path (and nothing else): …/scratchpad/blind3/corpus.raw.json
>
> WHAT TO WRITE:
> A JSON array of objects. Each object:
>   { "id": "<unique short id>", "kind": "secret" | "benign", "context": "<one of: log, config, env,
>   json, yaml, url, shell, stacktrace, ci, http, code, db, docker, chat, other>", "text": "<the
>   line or small block, may contain \n>", "secrets": ["<exact substring(s) of text that must be
>   hidden>"], "note": "<few words: what it is>" }
> - For kind "secret": "secrets" lists every credential value in the text, each an exact substring
>   of "text" (just the value, not the key name). At least one.
> - For kind "benign": "secrets" is []. The whole text must be left completely unchanged by a
>   correct masker.
>
> QUANTITY: at least 130 "secret" items and at least 90 "benign" items.
>
> SECRET items — realistic and varied, the way secrets actually leak in practice. Spread them
> roughly like this:
> - At least 20: credentials inside URLs, including userinfo passwords that contain characters a
>   person forgot to percent-encode (for example # / ? @ : % & = + ! $ and others, anywhere in the
>   password), across different schemes (database, message broker, cache, http(s), ftp, etc.), plus
>   query parameters carrying tokens/signatures and webhook URLs with a secret path. Put URLs in
>   varied surroundings (connection-string env lines, JSON, logs, error messages, command lines).
> - At least 15: passphrases containing spaces (several words), as values in .env-style lines,
>   YAML, INI, shell exports, JSON, and command-line flags. The "secrets" entry is the whole
>   passphrase.
> - At least 15: non-ASCII content — secret values containing non-ASCII characters (e.g. Japanese,
>   accented Latin, Cyrillic) and/or labels written in another language (e.g. Japanese "パスワード",
>   "APIキー", "トークン", German "Passwort", French "mot de passe", Spanish "contraseña") followed
>   by a value, in logs, chat messages, config files.
> - The rest: the usual formats — unquoted and quoted values in .env files, `export NAME=value`,
>   docker `-e`, INI/properties, systemd `Environment=`, YAML, TOML, JSON, code in several
>   languages (password, secret, token, api key, client secret, private key names — invent
>   realistic variable names); provider tokens with recognisable formats (cloud, source hosting,
>   payment, chat/bot, email/SMS, package registries, secrets managers, observability, CI, AI/LLM
>   API keys, SaaS APIs); HTTP headers and cookies, curl -H / -u, flags like --password or -p;
>   secrets embedded in log prefixes, stack traces printing a config, CI output, JSON nested in
>   logs, JWTs, PEM private key blocks, base64 basic auth.
>
> BENIGN items — harmless look-alikes that a sloppy masker might wrongly change. Include at least 8
> of each of these groups, plus others:
> - placeholders and templated references in credential positions: `${DB_PASSWORD}`, `$API_TOKEN`,
>   `${SECRET:-default}`, `{{ .Values.password }}`, `%(password)s`, `<your-token-here>`,
>   `process.env.SECRET_KEY`, `os.environ["PASSWORD"]`, `secrets.GITHUB_TOKEN`, empty values;
> - ordinary URLs with no credentials, including ones with `@` in the path or query (e.g. package
>   scopes, email addresses in a query), `#` fragments, `:port`, `user@host` SSH/git remotes without
>   a password, and URLs with `?`/`&` harmless parameters;
> - version numbers and ranges, including dependency lines where the package name contains a word
>   like token, secret, auth, key or password;
> - hashes and identifiers: git commit SHAs, checksums/integrity hashes, docker image digests,
>   UUIDs as request/trace ids;
> - prose and log lines that mention passwords/tokens/keys without a value, in English and in other
>   languages (e.g. Japanese "パスワードを変更しました", "トークンの有効期限が切れました"),
>   sentences with several ordinary words after a label-like word, token COUNTS
>   ("max_tokens=4096").
> Make them realistic and tricky, not trivially obvious.
>
> Keep each "text" to at most ~600 characters. Make sure the JSON is valid (validate it by parsing
> it with node or python after writing) and that every "secrets" entry is an exact substring of its
> "text", and ids are unique. When done, reply with ONLY: the output path, the number of secret
> items, and the number of benign items. Do not paste any of the corpus content in your reply.

The spec asks for more of the shapes the fifth audit found (URL passwords with special characters,
passphrases, non-ASCII values and labels) than a random sample of transcripts would hold, because
Round 5 set out to fix them. It gives no example value, and the agent saw none of the fixes; the
first of them (`80f524a`) was committed before the corpus existed. Rates on this corpus are a
measure of those shapes as much as of masking in general, and may read higher or lower than on a
random sample.

## The two halves

`scripts/split-blind-corpus.mjs` split the 397 items at random, stratified by kind, printing counts
only, before any of it was measured or read: `split.json` has the seed and the counts. The raw file
(sha256 `9f3970736ab2cf4c721820a12a4336b25d11e240f0076eeb4e15ce065fda99dc`) isn't committed; the
halves together are exactly its items, and the seed re-derives the split from it.

- `dev.json.b64`: 119 lines with secrets, 80 harmless. Used while fixing: measured on 0.7.1 and on
  the first fix (`80f524a`) first, then its misses were looked at, and the general shapes behind them
  were added to `redact.ts` (`src/redactBlind.test.ts` keeps it as a regression check, and lists the
  misses that remain).
- `holdout.json.b64`: 118 lines with secrets, 80 harmless. Not read by any test and not looked at.
  It was measured once, on 2026-10-01, on the 0.7.2 release tag, after 0.7.2 was published, rates
  only:
  [`docs/audits/2026-10-01-round-5-results/blind3-holdout.txt`](../../../../docs/audits/2026-10-01-round-5-results/blind3-holdout.txt).
  That run used it up: a change to `redact.ts` measured on it from now on isn't measured blind.

Both are base64-encoded JSON, so no provider-shaped fake credential sits in the repository as a
literal. `packages/core/test/blindCorpus.ts` decodes them, with the same measures as the first two
corpora.

## Measuring

```bash
node --experimental-strip-types scripts/redact-blind.ts dev --corpus 3             # the working tree
node --experimental-strip-types scripts/redact-blind.ts dev v0.7.1 --corpus 3      # redact.ts at a commit
node --experimental-strip-types scripts/redact-blind.ts dev --corpus 3 --show      # and every miss (dev only)
node --experimental-strip-types scripts/redact-blind.ts holdout --corpus 3         # rates only, never lines
```
