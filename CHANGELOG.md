# Changelog

Versions are shared (lockstep) across `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp`, and
`ctxjev-claude`, and the three plugin-manifest version fields Claude Code's installer reads
(`.claude-plugin/marketplace.json`, `packages/claude-plugin/.claude-plugin/plugin.json`,
`plugins/ctxjev/plugin.json`). A bump in one is a bump in all, even when only one changed.

## Unreleased

- `ctxjev-core`: secret masking no longer misses a credential that follows a label which isn't
  one. `Error: DB_PASSWORD=hunter22`, `env: API_KEY=…`, `out: password: …`, and
  `https://…?access_token=…` all went through unmasked, on every path: sent to Jev with
  `--scorer jev` or `CTXJEV_SCORER=jev`, and in the Claude Code plugin's default offline mode,
  written to `preserved.json` and re-injected after compaction. Found by the third independent audit.
- `ctxjev-core`: masks URL query parameters that carry a credential under a name of their own
  (`?sig=`, `?signature=`, `X-Amz-Signature=`, `?key=`, `?sessionid=`, `?jwt=`), and a token used
  as a URL's user name, such as a Sentry DSN's key or `https://<token>@github.com`.
- `ctxjev-core`: masks more token formats: HashiCorp Vault, DigitalOcean, Linear, Twilio API key
  SIDs, Mailgun, Mailchimp, Shopify, PyPI, Telegram and Discord bot tokens, Google OAuth client
  secrets, Slack app tokens, more GitLab token types, Docker Hub, Postman, New Relic, Atlassian,
  Databricks, Sentry auth tokens, Doppler, Terraform Cloud, Square, and several AI and hosting
  providers' keys; `sshpass -p`, `redis-cli -a`, and `docker login -p` passwords; and Teams and
  Zapier webhook URLs.
- `ctxjev-core`: `redactSecrets()` takes time in proportion to its input on long runs of one
  pattern. 100,000 characters of `a.a.a…` took 24 seconds; 200,000 of any of the audit's shapes
  now take well under a second.
- `ctxjev-claude`: the digest re-injected after compaction and the `/ctxjev:status` report are
  masked as they're read, not only when the snapshot was written, so a snapshot an earlier version
  wrote with the weaker masking doesn't bring a secret back. A malformed entry in `preserved.json`
  is skipped instead of logging a `toFixed` error.
- `ctxjev-claude`: the state directories (`~/.claude/ctxjev`, `sessions/`, and each session's) are
  made private to the user (0700) even when they already existed with looser permissions, and the
  plugin refuses to keep excerpts in one that belongs to another user.

## 0.6.1 — 2026-09-25

- `ctxjev-cli`: `ctxjev analyze` on an Anthropic Messages conversation reports what `ctxjev prune`
  would actually remove with the same settings (protection, the removal note, `--min-saved-tokens`),
  instead of counting every entry marked drop as saved. On
  `examples/sample-transcripts/anthropic-messages.json` it said "~46 / 156 tokens saved by dropping
  (29%)" while `prune` removes nothing there; it now says "prune would remove 0 of 8 entries, no tokens
  saved" and gives the same reasons `prune` does. `analyze` accepts `prune`'s Anthropic Messages
  options for this, and `analyze --json` adds `prune` (what `pruneMessages()` returned, without the
  messages); `savings` is unchanged and still counts the verdicts.
- `ctxjev-cli`: `analyze` counts verdicts as verdicts ("3 keep, 2 summarize, 2 drop", not "3 kept,
  2 summarized, 2 dropped"), and the legend says summarize means worth shortening: nothing is shortened
  unless you pass `--summarize-excerpts`. For ctxjev's own format it says `prune` would remove the
  entries marked drop; for a Claude Code transcript, that nothing is removed, since `prune` can't write
  one back (it used to report "tokens saved by dropping").
- `ctxjev-cli`: `prune --target-tokens` no longer says "what's left is protected" when nothing was
  removed and unprotected entries are still there.
- `ctxjev-cli`: `prune --scorer jev` prints the same Jev cost line as `analyze`; it used to spend
  without saying how much.
- `ctxjev-cli`, `ctxjev-core`, `ctxjev-mcp`: `--drop-below`/`--summarize-below` (and `dropBelow`/
  `summarizeBelow`) are described as what they are, thresholds on the score shown (relevance blended
  with recency) below which an entry is marked drop or summarize, not a relevance floor below which
  it's dropped. The docs for `relevance`, `SavingsReport`, and `overBudget` likewise say what those
  numbers are.
- `ctxjev-cli`: `ctxjev prune` says why each entry marked drop was kept, and calls only real
  protection "protected". It used to count every kept drop as "marked drop but protected", including
  ones left because removing them would save no tokens once the removal note is counted: on
  `examples/sample-transcripts/anthropic-messages.json`, "3 marked drop but protected" is now
  "1 protected as the first message; 2 not removed, since removing them would save no tokens once
  the removal note is counted".
- `ctxjev-core`: `pruneMessages()` returns `keptDrops`, the entries marked `drop` that weren't
  removed, by reason (`firstMessage`, `latestTurn`, `lastMessages`, `userText`, `noNetSaving`,
  `belowMinSaved`). A new field; nothing existing changed.
- README: the Quick Start's `ctxjev prune` example now uses a sample that the default settings
  actually prune and shows the command's real output (the old sample came back unchanged), and
  says why a short Anthropic Messages conversation can come back with nothing removed.

**Known issues** (not fixed yet; each number below errs on the low side or on a different scale,
never claims a saving that doesn't happen):

- Every token count is an estimate (`gpt-tokenizer`), not Claude's own tokenizer, which is why
  they're shown with `~`.
- `pruneMessages()`' `savedTokens` (and so `prune`'s "tokens saved" and `analyze`'s "would remove")
  counts text and tool calls only. An image removed with an entry, such as a screenshot in a tool
  result, isn't counted, so the real saving can be larger than reported. Counting it needs the
  image's size, which ctxjev doesn't read yet.
- The Claude Code plugin scores `local` with raw keyword overlap, while `ctxjev analyze --scorer
  local` ranks the overlap within the transcript, so the "score" in `/ctxjev:status` and the
  post-compaction digest isn't on the same scale as the CLI's for the same entries.

## 0.6.0 — 2026-09-25

**Breaking changes, in short** (each is described below): the default scorer of `ctxjev-core`,
`ctxjev-cli`, and `pruneMessages()` is `'recency'`, not Jev; the Claude Code plugin scores offline
unless you set `CTXJEV_SCORER=jev`; `pruneMessages()` never prunes the latest turn
(`protectLastTurn: false` to prune inside a single-instruction agent loop); and Jev scores cached
by earlier versions are ignored.

- `ctxjev-claude`: **scores offline by keyword overlap by default and sends nothing anywhere.** Jev
  is opt-in: set `CTXJEV_SCORER=jev` as well as `TYPESAFE_API_KEY` (a key alone no longer turns it
  on). On the preregistered holdout tasks the Jev-scored digest showed no demonstrated effect, and
  Jev's ranking kept less of what the tasks needed than keyword overlap did, so the default no
  longer sends your session to a third party. Neither scorer has been shown to help; see
  [Does It Work?](README.md#does-it-work).
- README, plugin README: the preregistered holdout comparison for the plugin did run, twice; both
  runs are now reported, and neither shows an effect. They used to say it never produced a result.
- `ctxjev-core` (and so the CLI, MCP server, and plugin): secret masking now also catches JSON-style
  credentials (`"password": "…"`, `"apiKey": "…"`), passwords in URLs (`postgres://user:pass@…`),
  Stripe, GitLab, npm, Hugging Face, SendGrid, and temporary AWS keys, AWS secret keys in prose,
  Slack and Discord webhook URLs, `Authorization: Basic`, Azure `AccountKey=`, `mysql -p…`,
  `curl -u user:pass`, and short passwords (`DB_PASS=hunter2`). It no longer masks look-alikes such
  as `tokenizer: gpt-tokenizer4`, placeholders, or `token = get_token()`.
- `ctxjev-core` (and so the CLI, MCP server, and plugin): Jev requests no longer carry your entry
  ids (each request names its entries `e0`, `e1`, … and maps the answers back) and mask tool names
  too. Masking also catches PGP private key blocks, payment card numbers (a card brand's prefix
  plus a valid check digit, so timestamps and ids are left alone), and tokens right after an
  underscore (`mcp__ghp_…`). Jev scores cached by earlier versions are ignored.
- `ctxjev-core`: a tool call's input is masked before it's shortened. Shortened first, a token cut
  at 160 characters could reach Jev as a prefix too short to recognize.
- `ctxjev-core`, `ctxjev-cli`: with `scorer: 'local'` / `--scorer local`, `pruneContext()` (and so
  `pruneMessages()` and `ctxjev prune`) ranks keyword overlap within the batch before applying the
  thresholds. Raw overlap rarely reaches the 0.3 drop threshold, so it used to drop nearly every
  entry, most of the relevant ones included. Tie handling was chosen on the dev split only
  (`eval/calibrate-local.mjs`). `scoreEntries()` and the Claude Code plugin still use raw overlap.
- `ctxjev-core`: `pruneMessages()` never touches the latest turn: your last instruction and every
  tool round-trip after it (`protectLastTurn`, default on). It used to protect only the last two
  messages, so a turn with three tool calls lost the first two. `protectLast` still applies as a
  floor. **Breaking for agent loops whose only user text is the first message**: that whole loop
  is now the latest turn and nothing is pruned; pass `protectLastTurn: false` to prune within it.
- `ctxjev-core`: `pruneMessages()` never makes a conversation larger. A removal smaller than its
  own "history was removed" note is no longer made (it used to report negative `savedTokens`), and
  `minSavedTokens` now counts the note. Very large conversations (150,000 tool calls) no longer crash
  it with a stack overflow.
- `ctxjev-core`, `ctxjev-cli`, `ctxjev-claude`: in a Claude Code transcript, a tool call that never
  got its result stays where it was made. It used to be moved after everything else, so the
  default `recency` scorer took it for the newest entry.
- `ctxjev-core`, `ctxjev-cli`, `ctxjev-claude`: a Claude Code transcript that repeats a record id is
  parsed, keeping the last copy with a warning, instead of failing as a whole (the plugin preserved
  nothing).
- `ctxjev-cli`: a broken or truncated JSON transcript is reported as such, with the line and column
  where it breaks, instead of "could not parse … as a Claude Code .jsonl".
- `ctxjev-core`: shortened text never splits an emoji or other multi-part character.
- `ctxjev-core`: an unknown `scorer` name (e.g. `'Jev'` from JavaScript) throws instead of silently
  ranking by recency.
- `ctxjev-cli`: the Jev score cache (`~/.cache/ctxjev/score-cache.json`) is now readable only by
  you (0600, in a 0700 directory), stores hashed keys instead of your goals and transcript text, and
  keeps at most 20,000 scores. Plain-text keys from earlier versions are removed the next time you
  run with `--scorer jev` (or delete the file).
- `ctxjev-core`: `cacheKeyFor()` returns a SHA-256 digest; keys from earlier versions don't match.
- `ctxjev-claude`: a `/ctxjev:set-goal` goal, error messages, and warnings are masked before they're
  saved to `~/.claude/ctxjev/`.
- `ctxjev-claude`: `/ctxjev:set-goal` and `/ctxjev:status` may run only the plugin's own
  `dist/status.js` without asking, instead of any `node` command (`Bash(node:*)`). The model can
  invoke `/ctxjev:set-goal` itself, so the old rule let it run arbitrary Node code unprompted.
- `ctxjev-claude`: cleaning up what versions before 0.6.0 left in your project removes only files it
  wrote, one at a time. It could previously delete your own files inside `.ctxjev/preserved/`.
- `ctxjev-claude`: `/ctxjev:status` says the last run is unknown when `last-run.json` can't be read,
  instead of "no compaction in this session", and shows transcript warnings.
- `ctxjev-cli`: `ctxjev prune --protect-last` on a ctxjev-format transcript is an error instead of
  being silently ignored (that format has no messages to protect). New `--no-protect-last-turn`
  for Anthropic Messages.
- `ctxjev-cli`: the report's legend says what the score means for the scorer used: under the
  default `recency` it's position in the transcript, not relevance. A run that saves nothing says
  "no tokens saved" instead of showing a number as saved.
- `ctxjev-cli`: `--version` / `-v` work after the command too (`ctxjev analyze --version`), and an
  unknown option gets a plain message pointing at `--help`.
- `ctxjev-mcp`: an entry's `id` and `toolName` are capped at 256 characters, so every string a
  tool call accepts is bounded (a 5,000,000-character id used to pass validation).
- `ctxjev-mcp`: starts without `TYPESAFE_API_KEY` and lists its tools; each call then returns an
  error saying the key is missing. Hosts used to see only "connection closed".
- `ctxjev-claude`: from this release on, the marketplace installs the plugin from the release's
  tag (`v0.6.0`), not from whatever is on `main`, so you only ever get released code.
- `ctxjev-mcp`: every setup example pins the version (`npx ctxjev-mcp@0.6.0` for this release), so
  hosts run the release you chose.
- `ctxjev-core`: new `jevClient` option (bring your own Jev client), and new exports
  `splitCjkBigrams()`, `quoteAsData()`, and `seededRandom()`.
- README: every evaluation number is generated from the saved results and checked in CI. The
  holdout retention table now includes random order and the labels, and says plainly that on the
  holdout Jev kept less of what the tasks needed than a random ordering. It also says that the
  default `recency` scorer ignores the goal.
- `ctxjev-claude`, `ctxjev-cli`: the inferred goal is no longer taken from text Claude Code writes
  into the conversation itself. After a `/model` and an interrupted tool call, it used to be the
  local-command notice plus "[Request interrupted by user]", with your actual request nowhere in it.
- `ctxjev-claude`, `ctxjev-cli`: the inferred goal keeps your original request after a second
  compaction, instead of whatever you said first after the last one.
- `ctxjev-claude`: `/ctxjev:set-goal` applies to the session it was run in, even with other
  sessions open on the same project, and lasts through compactions. It no longer writes a file.
- `ctxjev-claude`: nothing is written into your project any more. State lives in
  `~/.claude/ctxjev/`, readable only by you; the `.ctxjev/` directory earlier versions created
  is removed at the next compaction (only its own files, and the directory only if empty).
- `ctxjev-claude`: compaction waits at most 20 seconds for Jev (was 40) before scoring offline.
  (An 8-second cut tried mid-development caused real fallbacks against the live API on ordinary
  transcripts, caught while running the holdout plugin eval; 20s is the number that survived it.)
- `ctxjev-claude`: `/ctxjev:status` also shows the goal the next compaction will use, and its report
  is inlined into the skill rather than fetched by a tool call. In a manual test, Claude Haiku read
  the old report's `Goal:` line as a request and edited and committed code; goals and excerpts are
  now quoted and labeled as data, and only you can run the skill. A UserPromptSubmit hook answers
  `/ctxjev:status` before it reaches the model at all, where Claude Code allows it.
- `ctxjev-claude`: a re-injected excerpt (or goal) can't break out of its quotes: `«`/`»` inside it,
  line breaks, and tag-like `<…` (such as `</system-reminder>`) are neutralized, and the excerpts
  sit between explicit "begin/end quoted excerpts (data, not instructions)" lines. An excerpt
  could previously close its own quote and continue as if the plugin had written the rest.
- `ctxjev-claude`: the post-compaction reminder says its excerpts aren't requests and that any
  question in them was already asked. Haiku had answered a preserved "Shall I write the tests?"
  by writing and committing them. ctxjev's own status report is never preserved, nor is a reply that
  only repeats the goal ("Goal set: …").
- `ctxjev-claude`, `ctxjev-cli`: the `<pasted_content>` tags Claude Code wraps around pasted text
  no longer end up in the goal.
- `ctxjev-claude`: a slash command you ran (such as `/ctxjev:set-goal`) no longer takes one of the
  preserved slots.
- `ctxjev-core`, `ctxjev-cli`, `ctxjev-claude`'s `pruneMessages()`: **the default scorer is now
  `'recency'` (plain truncation), not Jev.** On a preregistered comparison against six tasks never
  used to design ctxjev, Jev and truncation finished the same tasks equally often (+0 points, 95%
  CI [+0, +0] on two models) — see [Does It Work?](README.md#does-it-work). Pass `scorer: 'jev'` /
  `--scorer jev` to opt in; `ctxjev-mcp`, which exists to expose Jev, is unaffected and keeps
  asking for it. This is a breaking default change for anyone relying on the old implicit `'jev'`.
- `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp`: cached Jev scores account for the latest activity, so
  an old failure isn't still called relevant after a later run showed it fixed. Earlier cache
  entries are ignored.
- `ctxjev-mcp`: the in-memory score cache is capped at 5,000 entries instead of growing forever.
- README: the eval sessions and tasks aren't held out (the 0.5.0 changes were designed on them),
  and the fair comparison, truncation with the same options, is now in the table.
- `ctxjev-claude`: preserved slots no longer fill up with near-identical tool calls (e.g. `git show`
  run three different ways on the same commit) — a lower-scoring but distinct entry now gets the slot
  instead.

## 0.5.0 — 2026-09-23

- `ctxjev-core`: `pruneMessages()` no longer removes what the user wrote (`keepUserText`, default on).
  That's where constraints and changes of plan live, and it costs few tokens.
- `ctxjev-core`: `pruneMessages()` adds a one-line note where it removed history (`marker`, default
  on), so the model re-reads files instead of trusting what it half-remembers. In the task eval, the
  two together took Jev-pruned runs from 90% to 100% of tasks passed.
- `ctxjev-cli`: `ctxjev prune --drop-user-text` / `--no-marker` turn those two off.
- `ctxjev-claude`, `ctxjev-cli`: the inferred goal is your first request plus your latest
  instruction, not the latest message alone. That one is usually a step like "also check the
  tests", which aimed scoring at the step instead of the task.

## 0.4.0 — 2026-09-23

- `ctxjev-core`: `pruneMessages()` takes `targetTokens`, to keep removing the lowest-scoring
  entries until the conversation fits a budget.
- `ctxjev-core`: `pruneMessages()` can shorten entries marked `summarize` instead of only
  reporting them: `summarize: 'excerpt'` keeps their head and tail, or pass your own summarizer.
- `ctxjev-core`: `pruneMessages()` reports what pruning costs a prompt cache
  (`cache.invalidatedTokens`), and `minSavedTokens` leaves the conversation untouched when the
  saving is too small to be worth that.
- `ctxjev-core`: `scorer` accepts your own scoring function alongside `'jev'` and `'local'`. It
  receives content with secrets already masked.
- `ctxjev-cli`: `ctxjev prune` gains `--target-tokens`, `--summarize-excerpts`, and
  `--min-saved-tokens` for Anthropic Messages transcripts, and prints the prompt-cache impact.
- `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp`, `ctxjev-claude`: the default `dropBelow` is 0.3
  (was 0.25). It drops more of what's stale without losing anything labeled relevant in the
  eval (see the README's "Does It Work?").

## 0.3.1 — 2026-09-23

- `ctxjev-cli`, `ctxjev-core`: token savings count what removing an entry actually saves. They
  used to count only the short excerpt that gets scored, so dropping a 45,000-token log showed as
  ~205 tokens. Entries carry the full size as `sourceTokens`, and `ctxjev-mcp` accepts it too.
- `ctxjev-cli`: `ctxjev analyze --help` and `ctxjev prune --help` print the help instead of
  rejecting the flag.
- `ctxjev-core`: offline scoring (`scorer: 'local'`, the CLI's `--offline`, the plugin without a
  key) now matches Japanese, Chinese, and Korean text; before, it ignored it, so a Japanese goal
  scored every entry 0 and the plugin preserved nothing.
- `ctxjev-core`: a short Japanese instruction ("ログイン画面のバグを直して") is no longer mistaken
  for an acknowledgment, so it can become the inferred goal and take a preserved slot.
- `ctxjev-core`: secrets written after a Japanese label ("パスワード：…", "APIキー: …") are masked
  before anything is sent to Jev or cached.

## 0.3.0 — 2026-09-23

- `ctxjev-core`: `pruneMessages()` takes an Anthropic Messages conversation and returns it with
  stale entries removed, still a valid request: each `tool_use` goes with its `tool_result`, and
  the first message and latest turn are never touched.
- `ctxjev-cli`: `ctxjev prune` writes a ctxjev-format or Anthropic Messages transcript back out
  with drops removed; `analyze` and `prune` both accept the Anthropic format.
- `ctxjev-core`: the inferred goal skips short acknowledgments ("yes, go ahead") in favor of the
  last message that describes the work.
- `ctxjev-core`: long tool output keeps its tail as well as its head, where test summaries and
  final errors usually are; a failed tool call is marked `[error]`.
- `ctxjev-claude`: an entry needs real relevance to take a preserved slot, not just recency, and a
  bare acknowledgment ("yes, go ahead") never takes one.
- `ctxjev-claude`: preserved context is kept per session, so two sessions on one project can't
  receive each other's.
- `ctxjev-claude`: Jev gets 40 seconds, then scoring falls back to offline and says so; the hooks
  declare explicit timeouts.
- `ctxjev-cli`: a one-line Claude Code `.jsonl` is recognized instead of misread as ctxjev's format.
- Releases are now gated on the eval (Jev must beat the offline baseline) and get a git tag and
  a GitHub Release.

## 0.2.0 — 2026-09-23

**Breaking:** `SavingsReport.savedTokens` is replaced by `droppedTokens` and `summarizableTokens`.

- **Privacy:** every request to Jev now masks common secret formats (API keys, tokens, JWTs,
  private keys, `NAME=value` credentials) to `[REDACTED]` first. Best-effort, not exhaustive.
- **Privacy (`ctxjev-claude`):** `.ctxjev/` is now created with its own `.gitignore`, so cached
  transcript excerpts can't be committed by accident. The README now says plainly what's sent.
- `ctxjev-claude`: tool entries say what was called (`Bash(npm test): …`), not just the tool name.
- `ctxjev-claude`: only entries since the last compaction are scored; older ones are already gone.
- `ctxjev-claude`: an explicit goal only applies to the session it was set in.
- `ctxjev-claude`: `/ctxjev:status` shows what the last run did and why (a missing API key is no
  longer indistinguishable from "working, nothing to show").
- `ctxjev-claude`: with no API key, or if Jev fails, scores offline by keyword overlap instead of
  preserving nothing, and labels the reminder as offline.
- `ctxjev-claude`: the goal's own message no longer takes a preserved slot; `CTXJEV_PRESERVE_LIMIT`
  (1–50) changes the default of 5.
- `ctxjev-core`: savings no longer count `summarize` as saved, since ctxjev can't summarize. The
  README's sample went from "39% saved" to the true 21%.
- `ctxjev-core`: each chunk's request now also sees the batch's latest activity, so a result that
  was superseded later can be judged as such across chunks. Cached scores from before are not reused.
- `ctxjev-core`: `scorer: 'local'` scores offline by keyword overlap; `ctxjev-cli` exposes it as
  `--offline`.
- `ctxjev-core`: excerpts parsed from Claude Code transcripts are up to 600 characters (was 300).
- README: leads with what each package actually does, and states the MCP server's limits up front.
- Eval: two new labeled fixtures, an offline baseline, and a top-K metric. On the hard one, Jev puts
  5 of 5 relevant entries in its top 5; keyword overlap puts 1.

## 0.1.12 — 2026-09-21

- Docs: README wording and heading capitalization across all packages.

## 0.1.11 — 2026-09-21

- `ctxjev-cli`: a failure to save the score cache no longer discards an analysis that succeeded.
- `ctxjev-core`: a message like "/deploy the hotfix now" is no longer mistaken for a slash command
  when inferring the goal.
- `ctxjev-mcp`: `goal` is capped at 2000 characters.

## 0.1.10 — 2026-09-21

- `ctxjev-mcp`: an infinite `timestamp` is rejected; one used to turn every entry's score into NaN.
- `ctxjev-claude`: a stale snapshot from an earlier compaction is no longer re-injected when a
  later run preserves nothing.
- `ctxjev-cli`: a transcript with tens of thousands of entries no longer crashes the report.
- `ctxjev-cli`: the score cache is saved even when a run fails partway, and written atomically.

## 0.1.9 — 2026-09-21

- `ctxjev-core`: a NaN score now throws instead of silently resolving to "keep".
- `ctxjev-core`: user messages with attachments, and tool calls that never got a result, are no
  longer dropped from parsed Claude Code transcripts.
- `ctxjev-core`: fixed possible score-cache key collisions between different entries.
- `ctxjev-core`: requests run at most 5 at a time, instead of all at once.
- `ctxjev-cli`: transcript entries are validated field by field; `--drop-below` must not exceed
  `--summarize-below`.
- `ctxjev-mcp`: scores are cached across calls; inputs are validated, and the number of entries,
  each entry's content, and the goal are size-capped. (Corrected in 0.6.0: this used to say every
  input was size-capped, but entry ids and tool names weren't until 0.6.0.)
- `ctxjev-claude`: the hook bundle shrank from 3.3MB to 17KB; the preserved-context file is
  written atomically; re-injected excerpts are labeled as quoted data, not instructions.

## 0.1.8 — 2026-09-21

- `ctxjev-claude`: fixed the `PreCompact` hook failing with `Cannot find package 'ctxjev-core'` on
  every fresh install (the hooks are now bundled).
- `ctxjev-claude`: the plugin manifests report the real version (they'd been stuck at 0.1.2).

## 0.1.7 — 2026-09-21

- `ctxjev-claude`: fixed both hooks failing with `MODULE_NOT_FOUND` on every fresh install
  (`dist/` is now committed).

## 0.1.6 — 2026-09-21

- `ctxjev-core`: entries with duplicate ids are rejected instead of corrupting each other's scores.
- `ctxjev-core`: optional score cache; `ctxjev-cli` uses `~/.cache/ctxjev/score-cache.json`
  (`--no-cache` to skip), so re-running the same analysis costs nothing.
- `ctxjev-cli`: invalid `--drop-below`/`--summarize-below` values are rejected instead of becoming NaN.

## 0.1.5 — 2026-09-21

- `ctxjev-mcp`: reports its real version to MCP clients (was `0.0.0`).

## 0.1.4 — 2026-09-21

- `ctxjev-core`: goal inference skips slash commands like `/compact`, which used to become the goal.

## 0.1.3 — 2026-09-21

- Docs and package metadata (keywords, author, engines).

## 0.1.2 — 2026-09-21

- `ctxjev-cli`: a one-line legend in the report, a real `--version`, all input problems reported
  at once, and a runnable example at the top of `--help`.
- `ctxjev-claude`: real descriptions in the plugin manifests.
- Codex plugin marketplace bundle (`.agents/plugins/marketplace.json`).

## 0.1.1 — 2026-09-21

- Fuller READMEs on npm; first release through npm Trusted Publishing.

## 0.1.0 — 2026-09-21

First public release: `ctxjev-core`, `ctxjev-cli`, and `ctxjev-mcp` on npm, and the
`ctxjev-claude` Claude Code plugin.
