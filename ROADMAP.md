# Roadmap

## Phase 0 — Scaffold ✅
- Monorepo structure, package skeletons, shared types.

## Phase 1 — Core ✅
- `packages/core`: `pruneContext()` working against the live Jev API (`@typesafe-ai/sdk`), verified
  end-to-end with a real `TYPESAFE_API_KEY`.
- Fan-out batching: one Jev request per chunk of entries (each its own `noul` question), evaluated in
  parallel against a shared state — see [`jevClient.ts`](packages/core/src/jevClient.ts).
- `packages/cli`: `ctxjev analyze <transcript.json>` — a plain-text report (entries pruned, estimated
  token savings) or `--json` for machine-readable output.
- Test fixtures: [`examples/sample-transcripts`](examples/sample-transcripts) — two hand-labeled
  transcripts now (`checkout-bug.json`, `memory-leak.json`), each carrying a `groundTruth` field
  used by the tuning pass below. Redacted excerpts from real Claude Code session `.jsonl` logs
  would be a further, messier addition — not done yet.

- **Composite scoring** ✅: `scoreEntries()` blends Jev's relevance with each entry's recency within the
  batch (oldest=0, newest=1 — see [`recency.ts`](packages/core/src/recency.ts)) per
  `PruningPolicy.recencyWeight`, producing a `combinedScore` that `pruneContext()` actually acts on.
  `scoreEntries()` and `pruneContext()` are separate exports — the MCP server's two tools map onto
  them directly (`score_relevance` → `scoreEntries`, `prune_history` → `pruneContext`).
- **`recencyWeight` tuned against real data ✅** (2026-09-21, [`eval/run.mjs`](packages/core/eval/run.mjs)):
  swept `recencyWeight` ∈ {0, 0.05, 0.1, 0.2, 0.3, 0.5} against both hand-labeled fixtures. Aggregate
  accuracy ties at 76.9% (10/13) for every weight from 0 through 0.2 — but `memory-leak.json`
  (deliberately adversarial: its root-cause entry is early *and* critical) starts degrading at
  `w=0.2` (67%, down from 83%) as recency starts dragging that entry's score down despite Jev
  rating it highly relevant. `w=0.1` (the existing default) sits on the safe side of that cliff
  with no aggregate cost — kept as-is, not because it was untested, but because testing it found no
  reason to change it. [`recencyWeight.live.test.ts`](packages/core/src/recencyWeight.live.test.ts)
  locks this in as a regression test: `DEFAULT_POLICY` must never drop an entry either fixture's
  ground truth marks relevant. Two fixtures is a thin base for real precision/recall tuning of
  `dropBelow`/`summarizeBelow` themselves (both borderline misses at low weight are entries sitting
  just above `dropBelow` despite low ground-truth relevance) — that needs more labeled data before
  touching those thresholds, and would risk overfitting to 13 data points otherwise.

## Phase 2 — MCP server ✅
- `packages/mcp-server`: `score_relevance` (wraps `scoreEntries` — scores only, no decision) and
  `prune_history` (wraps `pruneContext` — scores plus the keep/drop/summarize decision and a savings
  report) as MCP tools, registered via `McpServer.registerTool` with zod input schemas
  ([`schemas.ts`](packages/mcp-server/src/schemas.ts)).
- Verified two ways: an in-process client/server test over `InMemoryTransport`
  ([`server.live.test.ts`](packages/mcp-server/src/server.live.test.ts)) exercising the real MCP
  wiring, and a manual real-subprocess run over actual stdio (`StdioServerTransport`/
  `StdioClientTransport`) — both pass against the live Jev API.
- **Verified end-to-end in a real Claude Code session** (v2.1.278, 2026-09-21) —
  `claude mcp list` shows `ctxjev: ... ✔ Connected`. Getting there took a real finding, not just a
  restart: the project-level [`.mcp.json`](.mcp.json) this repo ships (`${TYPESAFE_API_KEY}`
  expanded from the launching shell's environment) never actually got approved in practice —
  `claude mcp list` silently omitted the server with no prompt and no error, even with the key
  present, workspace trust already accepted, and after manually pre-approving it in
  `~/.claude.json`'s `enabledMcpjsonServers`. `claude mcp add` (local/user scope) worked on the
  first try. See the README's "Using it from an MCP host" section for the working command — the
  project `.mcp.json` stays in the repo for whoever it works for out of the box, but `claude mcp
  add` is the documented fallback now, not an afterthought.

## Phase 3 — Claude Code plugin ✅ (design corrected)
**The original plan here was wrong.** Research into Claude Code's actual hooks system
(2026-09-21) found that hooks can *read* the transcript (via a `transcript_path` they're handed)
but **cannot modify or rewrite it** — there is no way for a hook to reach into Claude Code's own
compaction and selectively drop entries before it summarizes. "A hook that prunes ahead of Claude
Code's own compaction" was never buildable as originally worded.

What Claude Code actually supports, and what `packages/claude-plugin` builds instead: the
documented **PreCompact / SessionStart(matcher: "compact") re-injection pattern**.

- **`PreCompact` hook** ([`preCompact.ts`](packages/claude-plugin/src/preCompact.ts)): fires right
  before compaction. Reads `transcript_path`, parses Claude Code's own transcript format
  ([`transcript.ts`](packages/claude-plugin/src/transcript.ts) — internal/undocumented, isolated
  to one module since it may change between Claude Code versions), resolves a goal
  ([`goal.ts`](packages/claude-plugin/src/goal.ts) — explicit `.ctxjev/goal.txt` if set via the
  `/ctxjev:set-goal` skill, else the most recent user message), scores every entry with Jev, and
  caches the top few by combined score to `.ctxjev/preserved-context.json`. Never blocks
  compaction and never throws outward — a failure here (including a missing API key) is a silent
  no-op, since a bug in this plugin must never be able to break the user's actual session.
- **`SessionStart` hook, `matcher: "compact"`**
  ([`sessionStartCompact.ts`](packages/claude-plugin/src/sessionStartCompact.ts)): fires right
  after compaction finishes. Reads that cache and prints a digest to stdout — Claude Code adds
  this text to context as a system reminder, the one documented way a hook can put content *back*
  into context after compaction smooths it over.
- **Skills**: `/ctxjev:set-goal <text>` (writes the explicit goal) and `/ctxjev:status` (shows the
  current goal and the last `PreCompact` scoring pass) — both plain `SKILL.md` files, no code.
  **Verified in a real Claude Code session** (`claude --plugin-dir packages/claude-plugin`, v2.1.278,
  2026-09-21): `/ctxjev:status` ran correctly and reported no cache yet, exactly as designed for a
  fresh project.
- The hooks themselves were verified against a synthetic transcript (real
  `preCompact.js`/`sessionStartCompact.js` subprocesses, piped fake stdin, against the live Jev
  API) rather than a real compaction — forcing an actual compaction mid-session to confirm the
  live re-injection text appears is still open, but lower-priority now that the skill (same
  `--plugin-dir` load path) is confirmed working for real.

## Phase 4 — Further hosts ✅ (Codex verified hands-on, Copilot from research, Xcode ruled out — 2026-09-21)

- **Codex CLI** ✅ **verified for real** (2026-09-21, `codex-cli` v0.155.1, installed fresh via
  `npm install -g @openai/codex` specifically to check this): `codex mcp add ctxjev --env
  TYPESAFE_API_KEY=... -- node packages/mcp-server/dist/index.js` registers cleanly —
  `codex mcp get ctxjev` confirms the exact command/args/env stored correctly, `enabled: true`.
  **No adapter package needed**, confirmed rather than assumed. Config-level only: actually
  driving Codex through a real tool call needs Codex's own OpenAI/ChatGPT authentication, which
  this session doesn't have and won't set up (credential entry is out of scope for an agent to do
  on someone's behalf) — the server process itself is the same binary already proven working over
  real stdio for Claude Code, so this is a narrow, specific gap, not an open question about
  whether it works.
- **GitHub Copilot** (agent mode, GA since 2026-07): also a generic stdio MCP client per official
  docs, configured via `.vscode/mcp.json`'s `servers` key (note: `servers`, not Claude Code's
  `mcpServers`). **Not verified hands-on** — Copilot only runs inside the VS Code GUI, with its own
  GitHub sign-in; there's no CLI equivalent to `codex mcp add`/`claude mcp add` to script this the
  way Codex and Claude Code were actually verified. Documented from research only.
- **Xcode 26.3**: turned out to be the wrong shape of question. Xcode is an MCP *server*
  (`mcpbridge`) that exposes Xcode's own tools (build, run, simulator control) *to* external agents
  like Claude Code or Codex — it isn't itself a generic MCP client that would consume a third-party
  server like `ctxjev-mcp`. Its own AI panel lets you swap the underlying chat model, but true
  agentic/tool-calling behavior is reported to only work with the preconfigured providers (ChatGPT
  Codex, Claude Agent), not arbitrary added ones. **Conclusion: no `ctxjev`-for-Xcode adapter is
  applicable.** If you're doing Xcode-integrated agentic iOS development via Claude Code or Codex
  (with Xcode's MCP bridge feeding *them* Xcode-specific tools), `ctxjev`'s existing Claude Code
  plugin / MCP server already covers that session's context — Xcode is just one more tool source
  feeding the same agent, not a separate host to integrate with.

Given all three turned out to need either a one-line config change or nothing at all,
`packages/mcp-server` stays a single, host-agnostic package — there's no case here for a
dedicated per-host adapter package after all.

## Phase 5 — Hardening (2026-09-21)

- **The CLI can now read a real Claude Code transcript ✅.** `parseClaudeCodeTranscript()` moved
  from `packages/claude-plugin` into `packages/core` (both `ctxjev-cli` and `ctxjev-claude` import
  it from there now — it was never plugin-specific, just built there first). `ctxjev-cli analyze`
  auto-detects the format: a `JSON.parse` failure on the whole file falls back to the Claude Code
  `.jsonl` parser instead of erroring, with the goal inferred from the most recent user message
  (`inferGoalFromEntries()`, also shared) unless `--goal` overrides it. New fixture:
  [`examples/sample-transcripts/claude-code-session.jsonl`](examples/sample-transcripts/claude-code-session.jsonl).
  **Never point this at a real `~/.claude/projects/*/*.jsonl` file** — see the warning in
  [`CLAUDE.md`](CLAUDE.md); entry content gets sent to the live Jev API.
- **Sidechain entries are now excluded ✅** — a real bug, not just a gap: `parseClaudeCodeTranscript`
  was merging subagent-internal messages (`isSidechain: true`) into the main thread's scoring pass.
  A subagent's work already shows up in the main thread as an ordinary tool_use/tool_result pair;
  its private back-and-forth getting there was never part of what Claude Code would compact for the
  *parent* session, so scoring it was scoring content outside what this plugin actually protects.
- **Retry logic: investigated, none added — `@typesafe-ai/sdk`'s `TypeSafeClient` already retries**
  connection failures, timeouts, and 408/429/500-599 responses by default (its `RetryPolicy`).
  Hand-rolling this in `jevClient.ts` would have been a worse copy of what the SDK already does;
  documented instead of duplicated.
- **Jev token usage/cost is now tracked and surfaced ✅.** `scoreEntries()`/`pruneContext()` take an
  optional `{ onUsage }` callback (non-breaking — existing call sites without it are unaffected),
  fired once per underlying Jev request with that request's `{ inputTokens, outputTokens }`.
  `ctxjev-cli`'s report and `--json` output, and both MCP tools' responses, now include a `usage`
  total and (CLI only) an estimated USD cost (`packages/cli/src/cost.ts`, at Jev's published
  $0.042/M input-token rate). Every "tokens saved" claim in this README was already backed by a
  real tokenizer; now every cost claim is backed by what Jev itself actually billed.
- **Real mid-session `/compact` verification: still open, deliberately not attempted.** Forcing an
  actual autocompaction (`--autocompact 100000`, the CLI's minimum) needs a genuinely large context
  — cheap in Jev terms, but a real, non-trivial spend of the *user's own Claude API/subscription
  usage*, not something to spend without asking first. The hooks are verified against a synthetic
  transcript (see Phase 3); the one remaining unverified link is whether Claude Code's own
  documented "stdout on `SessionStart(compact)` becomes a system reminder" behavior holds in
  practice, which is really a claim about Claude Code, not about `ctxjev`.

## Phase 6 — First npm release ✅ (v0.1.0, 2026-09-21)

`ctxjev-core`, `ctxjev-cli`, and `ctxjev-mcp` are live on npm (`ctxjev-claude` stays repo-only —
see the README's Claude Code plugin section for why). Getting there surfaced real, current npm
policy that's worth recording since it cost real time to work through:

- **The bootstrap problem**: npm's newer "Trusted Publishing" (OIDC from GitHub Actions, no
  token) — which is genuinely the right long-term setup, see below — **cannot be configured for a
  package that has never been published.** Both it and the newer "stage + approve" flow
  (`npm stage publish` → `npm stage approve`) require the package to already exist; a stage attempt
  on a brand-new name 404s. First publish of anything new has no way around a classic,
  human-authenticated `npm publish`.
- **The actual fix**: a Granular Access Token with **"Read and write (publish and stage)"**
  *and* **"Bypass two-factor authentication (2FA)"** both set — easy to miss either one (we hit
  both: first the bypass box unchecked, then the permission level set to "stage only" instead of
  "publish and stage") and the resulting 403/404s don't clearly say which. `pnpm publish
  --no-git-checks` with that token worked immediately once both were right.
- **`pnpm publish` vs. workspace ranges**: unrelated to the above, but relevant to any future
  publish — `pnpm publish` correctly rewrites `ctxjev-core`'s `workspace:*` dependency range in
  `ctxjev-cli`/`ctxjev-mcp` into a real version (verified: `0.1.0`) before uploading. Publish order
  matters — `ctxjev-core` first, so that version actually exists when the other two are packed.
- **Verified for real, not just "upload succeeded"**: fresh `npm install` of both `ctxjev-cli` and
  `ctxjev-mcp` into a clean scratch directory, then actually ran the CLI against a sample
  transcript and connected a real MCP client to the installed server — both worked identically to
  the local dev build.
- **[`.github/workflows/publish.yml`](.github/workflows/publish.yml)** is ready for every release
  after this one: OIDC Trusted Publishing, no token to manage or rotate. `pnpm publish` doesn't yet
  speak OIDC itself ([pnpm/pnpm#9812](https://github.com/pnpm/pnpm/issues/9812)), so the workflow
  packs with `pnpm pack` (for the same workspace-range rewrite) and publishes the resulting tarball
  with plain `npm publish`, which is OIDC-aware. **Not yet configured**: each package's Trusted
  Publisher settings on npmjs.com (org `x96x64`, repo `ctxjev`, workflow `publish.yml`) — do this
  once per package, now that all three exist, before relying on the workflow for `v0.1.1`.
