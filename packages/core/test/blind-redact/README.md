# Blind secret-masking corpus

Lines for measuring `redactSecrets()` (`packages/core/src/redact.ts`) against tests its author
didn't design. Round 3 of the audit follow-up asked for this after the third audit
(`docs/audits/2026-09-25-audit-3-ja.md`, appendix C-3) pointed out that "51/51 formats" only meant
the masking passed a table written by the same person who wrote the masking.

## Where the lines came from

On 2026-09-25 a separate agent, which had not seen `redact.ts`, its tests, or anything else in the
repository, was given only the spec below and wrote 267 items: 182 lines containing secrets and 85
harmless look-alikes. It was told not to open any file on the machine, and to generate every fake
credential value with a random generator. Nobody edited the items afterwards. None of the values
is a real credential.

The spec, as given:

> You are writing an independent, blind test corpus for a secret-masking ("redaction") function.
> The function takes one string (a line or small block of text from an AI coding agent's
> transcript: tool output, logs, configs, commands, error messages) and must replace credential
> VALUES with a placeholder, while leaving everything else unchanged.
>
> STRICT RULES (important, the whole point is independence):
> - Do NOT open, read, list, grep, or search ANY existing file on this machine — not the repository
>   in /home/user, not node_modules, nothing. Work only from your own general knowledge of how
>   secrets appear in real-world text.
> - You MAY use Bash/python/node only to (a) generate random characters for fake credential values
>   and (b) write your output file. Nothing else.
> - Every credential value must be FAKE: generate random characters in the correct
>   alphabet/length/prefix for that credential type. Never paste a real credential. Don't use
>   obviously patterned fillers like "abcd1234" or "xxxx" or "EXAMPLE"; values should look like real
>   randomly generated keys (use a random generator).
> - Write the result to exactly this path (and nothing else): …/scratchpad/blind/corpus.raw.json
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
> QUANTITY: at least 130 "secret" items and at least 70 "benign" items.
>
> SECRET items — make them realistic and varied, the way secrets actually leak in practice. Cover a
> broad spread, e.g.:
> - Provider tokens with recognisable formats (cloud providers, source-hosting platforms, payment,
>   chat/bot, email/SMS, package registries, secrets managers, observability/error-tracking, CI
>   services, AI/LLM API keys, SaaS APIs — as many different real-world formats as you know, each
>   with the right prefix/length/alphabet).
> - Generic assignments in .env / shell export / docker -e / k8s YAML / INI / TOML / JSON config /
>   Python/JS code (e.g. a variable or key named like password, secret, token, api key, client
>   secret, private key, etc.).
> - Credentials inside URLs: userinfo in connection strings (postgres, mysql, mongodb, redis, amqp,
>   https), query parameters carrying tokens/keys/signatures (OAuth callbacks, pre-signed URLs,
>   webhooks).
> - HTTP headers and cookies (Authorization Bearer/Basic, X-API-Key style headers, session
>   cookies), curl commands with -H or -u.
> - Secrets embedded inside other text: log lines with a prefix ("Error: ...", "WARN ...",
>   timestamps), stack traces or exception messages that print a config or connection string, CI
>   output, shell history lines, JSON nested in logs, command-line flags like --password or -p,
>   JWTs, PEM private key blocks (multi-line is OK), SSH keys, base64-encoded basic auth, webhook
>   URLs with a secret path.
> - Mix languages/locales a little (e.g. a Japanese or German log message around a secret).
>
> BENIGN items — harmless look-alikes that a sloppy masker might wrongly change. E.g.: git commit
> SHAs, UUIDs used as request/trace IDs, checksums/integrity hashes in lockfiles, docker image
> digests, version strings, token COUNTS ("tokens: 512", "max_tokens=4096"), variable or key NAMES
> mentioned without a value, placeholders and templated references (e.g. `${API_KEY}`,
> `<your-token-here>`, `process.env.SECRET_KEY`, `os.environ["PASSWORD"]`), empty values,
> documentation sentences about passwords, CSS colours, long base64 image data or font data,
> random-looking file names, public keys/certificate fingerprints that are not secret, URLs with
> harmless query parameters (page, sort, utm_*, ids), log lines that say "password reset email
> sent", "token expired", etc. Make them realistic and tricky, not trivially obvious.
>
> Keep each "text" to at most ~600 characters. Make sure the JSON is valid (validate it by parsing
> it with node or python after writing). When done, reply with ONLY: the output path, the number of
> secret items, and the number of benign items. Do not paste any of the corpus content in your
> reply.

## The two halves

`scripts/split-blind-corpus.mjs` split the 267 items at random, stratified by kind, printing counts
only: `split.json` has the seed and the counts. The raw file (sha256
`26a175175a13d7da8f2e9e81e52a0e213d1e957949309b9a35cd44e78da8acdb`) isn't committed; the halves
together are exactly its items, and the seed re-derives the split from it.

- `dev.json.b64`: 91 lines with secrets, 43 harmless. Used while fixing: its misses were looked at,
  and the general shapes behind them were added to `redact.ts` (`src/redactBlind.test.ts` keeps it
  as a regression check, and lists the misses that remain).
- `holdout.json.b64`: 91 lines with secrets, 42 harmless. Not read by any test and not looked at.
  It is measured once, at the end of Round 3, and reported as measured, whatever the result.

Both are base64-encoded JSON, so no provider-shaped fake credential sits in the repository as a
literal (a secret scanner would rightly flag one). `packages/core/test/blindCorpus.ts` decodes them.

## Measuring

```bash
node --experimental-strip-types scripts/redact-blind.ts dev             # the working tree
node --experimental-strip-types scripts/redact-blind.ts dev d55aa18     # redact.ts at a commit
node --experimental-strip-types scripts/redact-blind.ts dev --show      # and every miss (dev only)
node --experimental-strip-types scripts/redact-blind.ts holdout         # rates only, never lines
```

The measures were fixed before anything was measured (`packages/core/test/blindCorpus.ts`): a line
with secrets is detected when no piece of any of its secrets min(8, its length) characters long is
left in the output, other than a piece that also appears in the line away from the secrets; a
harmless line is a false positive when the output differs from it at all.
