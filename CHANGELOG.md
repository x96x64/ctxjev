# Changelog

Versions are shared (lockstep) across `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp`, and
`ctxjev-claude` — a version bump in one is a version bump in all four, even when only one
actually changed.

## 0.1.2 — 2026-09-21

- **`ctxjev-cli`**: the report now opens with a one-line legend explaining what `score` and
  `keep`/`summarize`/`drop` mean — first-time output shouldn't need someone else to explain it.
- **`ctxjev-cli`**: `--version` now reads the installed package's actual version instead of a
  hardcoded string that had already gone stale.
- **`ctxjev-cli`**: a missing `TYPESAFE_API_KEY` and a bad transcript path are now both reported
  in one run, instead of only the first one found — fixing the key and re-running used to be
  the only way to discover the path was wrong too.
- **`ctxjev-cli`**: `--help` now leads with a copy-pasteable "try it right now" example (fetches
  the repo's sample transcript directly), rather than starting with the flag reference.
- **`ctxjev-claude`**: the plugin's Overview, Skills, and Hooks descriptions (`plugin.json`,
  `marketplace.json`, `README.md`) were rewritten from a placeholder one-liner to real,
  descriptive content, matching the style of the other three packages' READMEs.
- **`ctxjev-claude`**: removed a duplicate `category` field from `plugin.json` that
  `claude plugin validate .` flagged — it belongs only in `marketplace.json`'s plugin entry.
- Added a Codex-specific plugin marketplace bundle (`.agents/plugins/marketplace.json`,
  `plugins/ctxjev/`), following the [Agent Plugins](https://agent-plugins.org) `1.0.0` schema, so
  `ctxjev-mcp` can be installed via `codex plugin marketplace add`/`codex plugin add` instead of
  only `codex mcp add`.

## 0.1.1 — 2026-09-21

- Per-package READMEs on npm expanded to match the main repo's style (badges, real captured
  examples) instead of minimal stubs.
- First real use of [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (GitHub
  Actions OIDC) to ship a release — no npm token involved.

## 0.1.0 — 2026-09-21

First public release.

- `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp` published to npm; `ctxjev-claude` stays repo-only
  (Claude Code plugins aren't npm-installed).
- Composite scoring (Jev's relevance blended with each entry's recency) tuned against
  hand-labeled fixtures, not left as an untested default.
- MCP server (`score_relevance`, `prune_history`) verified against Claude Code (real session)
  and Codex CLI (real config registration).
- Claude Code plugin: `PreCompact`/`SessionStart` re-injection pattern, plus `/ctxjev:set-goal`
  and `/ctxjev:status` skills.
- `ctxjev-cli` reads a real Claude Code `.jsonl` transcript directly, auto-detected, alongside
  its own JSON format.
- Jev token usage and estimated cost surfaced in the CLI report and both MCP tool responses.
