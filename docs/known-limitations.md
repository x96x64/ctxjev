# Known limitations

What ctxjev doesn't do, or doesn't do well, as of 1.0. Each item says why it is the way it is, and
links the issue that tracks it. Every open issue is summarized here, and the linked issues hold the
full, itemized lists (some, such as the masking misses, are too long to repeat). The limits of the
evaluation itself, and of its data, are in
[evaluation.md](evaluation.md#known-limitations-of-the-evaluation).

## What it can and can't do

- **Its benefit hasn't been shown.** On held-out tasks, no scorer helped an agent finish more tasks
  than plain truncation, and the Claude Code plugin's digest has no demonstrated effect. See
  [evaluation.md](evaluation.md).
- **No compaction integration for Codex.** Codex gets the MCP tools only. Codex has compaction
  hooks, but ctxjev doesn't read Codex's own session logs, so it can't score a Codex session at
  compaction ([#44](https://github.com/x96x64/ctxjev/issues/44), [ROADMAP](../ROADMAP.md)).
- **An MCP tool can't shrink its host's context**, and the agent pays output tokens to send its
  history as arguments, so calling one doesn't save tokens by itself.
- **The Claude Code plugin can't remove anything.** Hooks can read the transcript but not rewrite it;
  the plugin adds a digest after compaction and leaves the compaction itself alone.
- **Claude Code's session log format isn't documented.** The parser follows what Claude Code writes
  today; a change there can change what ctxjev reads until it's updated.
- **Token counts are estimates.** They come from `gpt-tokenizer`, an approximation of Claude's
  tokenizer. On long runs of one repeated pattern the estimate can be well off; on realistic text
  it's close ([#20](https://github.com/x96x64/ctxjev/issues/20)).
- **An image isn't counted.** `pruneMessages()`' `savedTokens` (and so `prune`'s "tokens saved" and
  `analyze`'s "would remove") counts text and tool calls only. An image removed with an entry, such
  as a screenshot in a tool result, adds nothing, so the real saving can be larger than reported:
  ctxjev doesn't read an image's size.

## Secret masking

`redactSecrets()` masks common secret formats before anything is sent to Jev or written to disk. It
is pattern matching, so it is best-effort. How well it works on lines written without sight of its
code is in [evaluation.md](evaluation.md#secret-masking-measured-blind).

- **Misses that remain.** Secrets in prose with no `:` or `=` (`the password is hunter2`), a
  full-width value after a label in another language or a full-width colon (`パスワード：Ｑｘ７ｖＲ２ｍＫｐＬ`), a
  digit-only value after a credential name other than a password's (`API_KEY=12345678`,
  `secret: 12345678`) or a label in another language, passphrases made of common words in YAML, some
  command-line and cloud-CLI shapes (`ldapsearch -w`, `aws secretsmanager get-secret-value`
  output, strongSwan and Cisco pre-shared keys), quoted `NAME=value` assignments where the quote
  wraps the whole assignment, inline environment variables before a command, a passphrase holding
  an escaped quote, a key passed as a bare argument (`snyk auth <uuid>`), and key prefixes the
  rules don't know. The full, current lists are in
  [#16](https://github.com/x96x64/ctxjev/issues/16),
  [#27](https://github.com/x96x64/ctxjev/issues/27), and
  [#38](https://github.com/x96x64/ctxjev/issues/38).
- **Deliberate choices.** A value that reads as a variable reference (`$NAME`, `${NAME}`,
  `%NAME%`) is taken for a placeholder and left alone, even when a real password happens to look
  like one. So is `${NAME?message}`, and `${NAME:?message}` with its message, except after a
  password's name (`DB_PASSWORD=${DB_PASSWORD:?required}`), where it is masked whole. A value
  shaped like a dependency coordinate (`API_KEY=abc:1.2.3`) isn't masked, nor is a single plain
  word (`AUTH foobared`). A digit-only value is masked only after a password's name (`password`,
  `passwd`, `pwd`, `passphrase`): after other names a number is usually a setting
  (`MAX_TOKENS=100000`). Prose after a label (`Token: expired yesterday`) is kept, and so is what
  reads as code: a reference ending in the name (`password: config.Password`) or a call whose
  parts all look like names (`Pass(word)`) ([#27](https://github.com/x96x64/ctxjev/issues/27)).
- **Over-masking.** Some harmless text is masked: a second quoted argument after a credential-like
  name, prose shaped like a `.netrc` line, an AWS Secrets Manager ARN's name, a scp-style URL with no
  user name, a placeholder in a typed declaration (`apiKey: string = "YOUR_API_KEY_HERE"`), and
  Japanese prose that mixes letters and digits after a label.
- **Cosmetic and edge cases.** Some masked output looks odd (`Cookie: [REDACTED]"[REDACTED]"`), and
  long chains of glued-together secrets may need more than the four passes masking runs, so masking
  twice can mask more. Masking ordinary text is several times slower than in 0.6.1, still linear.

## Claude Code plugin

- **State checks are best-effort** ([#17](https://github.com/x96x64/ctxjev/issues/17)). The plugin
  refuses a state directory or file that is a symlink, a hard link, owned by another user, or
  writable by others, but the check and the read are separate steps (a race), directories above the
  state root aren't checked, and Windows has no owner or mode bits to check. All of this matters
  only if another user can write to those directories.
- **A malformed line in an old part of a session log** is warned about on every run, because the
  warning counts lines from before the last compaction too ([#38](https://github.com/x96x64/ctxjev/issues/38)).
- **The status hook's lazy import relies on `status.js`'s own main guard**, and its speed is
  measured by hand (`scripts/time-status-hook.mjs`), not in CI; CI only checks the bundle stays small
  ([#29](https://github.com/x96x64/ctxjev/issues/29)).

## Releases and the marketplace

- **The marketplace names the plugin by its release tag, not a commit**
  ([#22](https://github.com/x96x64/ctxjev/issues/22)). Pinning a commit would make a release
  installable as soon as its pull request merges, before the publish workflow's checks; the tag
  exists only once they've passed. A repository ruleset protects `v*` tags from being moved or
  deleted, so the tag is only as fixed as that setting.
- **The npm pages' links point at the release tag**, which the publish workflow creates in its last
  step. If that step failed after the packages were published, those links would 404 until the tag
  exists ([#44](https://github.com/x96x64/ctxjev/issues/44)).

## The evaluation harness

- **It runs shell commands a model chose.** The task-completion evals run them in a sandbox
  (`packages/core/eval/sandbox.mjs`), and unconfined only when `CTXJEV_SANDBOX=none` is set; see
  [SECURITY.md](../SECURITY.md). It's a development tool, not part of any package.

## Library, CLI, and MCP server

- **A Jev answer a hair outside 0 to 1** fails the batch instead of being clamped. Jev hasn't been
  seen to return one; failing loudly was chosen over guessing
  ([#29](https://github.com/x96x64/ctxjev/issues/29)).
- **The MCP tools' strict input** adds `additionalProperties: false`, which a host whose schema
  converter rejects that keyword couldn't use (none seen), and refuses `_meta` inside `arguments`
  (the MCP specification puts it in `params`) ([#38](https://github.com/x96x64/ctxjev/issues/38)).
- **`prune --goal X --out f`, then `analyze f`** doesn't carry X over: `prune` never writes `--goal`
  into its output, on purpose ([#38](https://github.com/x96x64/ctxjev/issues/38)).
- **A transcript whose first entry isn't the user's** (the bundled `checkout-bug.json` starts with a
  test run) has no original request to protect, so the default can remove its first entry; `prune`
  and `analyze` warn when it does ([#20](https://github.com/x96x64/ctxjev/issues/20)).
- **`pruneMessages()` with `targetTokens: 0`** re-counts the removal note at every step: linear, but
  slower than it needs to be on very long conversations ([#20](https://github.com/x96x64/ctxjev/issues/20)).

## Tests and checks

- **Code the tests don't pin down.** A few checks can be changed without any test failing (surviving
  mutants), mostly length bounds in masking rules and redundant input checks that another check
  catches first ([#18](https://github.com/x96x64/ctxjev/issues/18), [#20](https://github.com/x96x64/ctxjev/issues/20)).
- **One test would hang rather than fail.** If the `estimateTokens` fix were reverted,
  `tokenEstimate.test.ts` would hang: the synchronous tokenizer can't be interrupted by the test
  runner's timeout ([#20](https://github.com/x96x64/ctxjev/issues/20)).
- **The docs checks read numbers, not meaning.** `check-docs.mjs` catches a hand-typed or changed
  eval number, not a sentence that changes a result's meaning without one ("found no difference" to
  "found a difference"); its claim detection relies on a word list; its selftest exercises a copy of
  the main loop's logic ([#22](https://github.com/x96x64/ctxjev/issues/22), [#38](https://github.com/x96x64/ctxjev/issues/38)).
  Its prose check skips numbers inside quotes or backticks and phrases like "N% of its tokens".
  `check-translations.mjs` likewise can't see a translated sentence that says the opposite with the
  same numbers, and doesn't compare links written as `<a href>`, reference definitions, or bare
  URLs, code fenced with `~~~` or indented, full-width digits, or a dropped link to an in-page
  anchor ([#44](https://github.com/x96x64/ctxjev/issues/44)).
- **Link and README checks have gaps**: a link with a title, an angle-bracket target, or a
  single-quoted `href` isn't seen; only code fences at the start of a line count as code; and the
  packed-README check ignores "no example found" (`check-readme-examples.mjs` still catches a lost
  example in the committed READMEs) ([#44](https://github.com/x96x64/ctxjev/issues/44)).
- **The growth-based speed tests** compare the time for n and 10n inputs, so they catch slowdowns
  faster than linear, not a constant-factor slowdown ([#38](https://github.com/x96x64/ctxjev/issues/38)).
- **The boundary brute force** accepts any plain `Error` and limits each call to a few seconds,
  which a slow machine could exceed ([#20](https://github.com/x96x64/ctxjev/issues/20),
  [#22](https://github.com/x96x64/ctxjev/issues/22)).
- **The offline retention gate's `recency` half** ranks by position in the script itself; the
  library's own recency scorer is covered by core's unit tests ([#38](https://github.com/x96x64/ctxjev/issues/38)).
- **`check-sessions.mjs` pins how many English probe fields** two sessions have, not which ones, and
  no test covers a known session whose count changes ([#31](https://github.com/x96x64/ctxjev/issues/31)).
- **The Codex check shows the configuration Codex resolves**, not the environment of a running
  server ([#44](https://github.com/x96x64/ctxjev/issues/44)).
- **`scripts/loadRedact.ts`** reports a git ref it can't read as `ERR_MODULE_NOT_FOUND` rather than
  as an unknown ref ([#27](https://github.com/x96x64/ctxjev/issues/27)).

## Dependencies and platforms

- **TypeScript 7 and `@types/node` 26 are held back** ([#4](https://github.com/x96x64/ctxjev/issues/4)):
  typescript-eslint doesn't support TypeScript 7 yet, and `@types/node` 26 would let code use APIs
  that Node.js 20 and 22 users don't have.
- **Node.js 20 has reached end of life** but is still supported; see the policy in
  [api-stability.md](api-stability.md#nodejs).
