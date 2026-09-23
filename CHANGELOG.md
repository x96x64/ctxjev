# Changelog

Versions are shared (lockstep) across `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp`, and
`ctxjev-claude`, and the three plugin-manifest version fields Claude Code's installer reads
(`.claude-plugin/marketplace.json`, `packages/claude-plugin/.claude-plugin/plugin.json`,
`plugins/ctxjev/plugin.json`). A bump in one is a bump in all, even when only one changed.

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
- `ctxjev-mcp`: scores are cached across calls; inputs are size-capped and validated.
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
