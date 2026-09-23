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
  first try. See the README's "Using It from an MCP Host" section for the working command — the
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
  (originally `packages/claude-plugin/src/transcript.ts`, since moved to
  [`packages/core/src/claudeCodeTranscript.ts`](packages/core/src/claudeCodeTranscript.ts) — see Phase 5 — internal/undocumented, isolated
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
  real tokenizer; now every cost claim is backed by what Jev itself actually billed. (Those
  savings claims still counted `summarize` as saved until Phase 11 separated the two.)
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
- **[`.github/workflows/publish.yml`](.github/workflows/publish.yml)**: OIDC Trusted Publishing,
  no token to manage or rotate. `pnpm publish` doesn't yet speak OIDC itself
  ([pnpm/pnpm#9812](https://github.com/pnpm/pnpm/issues/9812)), so the workflow packs with `pnpm
  pack` (for the same workspace-range rewrite) and publishes the resulting tarball with plain
  `npm publish`, which is OIDC-aware.

## Phase 7 — Trusted Publishing verified for real (v0.1.1, 2026-09-21)

Configured each package's Trusted Publisher on npmjs.com (org `x96x64`, repo `ctxjev`, workflow
`publish.yml`) and used `gh workflow run publish.yml` to publish `v0.1.1` — a README-only release
for all three packages, chosen deliberately as a low-stakes first real test of the new pipeline.

- **First attempt failed**: `403 OIDC permission denied for this action`. A Trusted Publisher
  configuration has its own **"Allowed actions"** setting, separate from the publisher identity
  (org/repo/workflow) — it must explicitly permit `npm publish` (direct), not just `npm stage
  publish`. Same shape of gotcha as the access-token saga in Phase 6: npm's newer security
  surface has more than one place that defaults to the safer, stage-only option.
- **Second attempt succeeded**, but `npm view` and the registry API both still reported `0.1.0`
  for a couple of minutes afterward — `npm publish`'s own output said as much
  (`"Your package is being processed and may take a few minutes to become available"`), so this
  was expected propagation delay, not a failure. Confirmed on the registry within ~2 minutes.
- End-to-end, this is now: bump version → commit/push → `gh workflow run publish.yml` → done. No
  token to create, rotate, or leak.

## Phase 8 — Usability pass + desktop-app plugin install (v0.1.2, 2026-09-21)

A first-time user's own confusion drove this one directly: reading `ctxjev-cli`'s report, they
didn't know what `score 0.46` meant until it was explained in chat. Fixed in the tool itself
rather than leaving it as something everyone has to be told:

- The report now opens with a plain-language legend (`score` range, what `keep`/`summarize`/`drop`
  mean) — verified against a fresh first-run.
- `--version` was reporting a hardcoded `"0.0.0"` that had silently gone stale through three
  releases — now reads the installed package's real version.
- A missing `TYPESAFE_API_KEY` and a bad transcript path used to surface one at a time (fix the
  key, re-run, *then* discover the path was also wrong) — both are reported together now.
- `--help` leads with a copy-pasteable "try it right now" (fetches the repo's own sample
  transcript over HTTPS) instead of starting with the flag reference — works precisely because
  the repo is now public (see below).

**The repo went public.** Confirmed no secret ever landed in git history (full `git log --all -p`
sweep, only placeholder `TYPESAFE_API_KEY=...` strings in docs) — and it needed to happen anyway,
since every npm-published README already linked to `github.com/x96x64/ctxjev`, which 404'd for
every npm user while the repo was private.

**Desktop app plugin install — researched, then actually verified, not left as a guess.**
Research said a `.claude-plugin/marketplace.json` at the repo root (pointing `source` at the
monorepo subdirectory `./packages/claude-plugin`) would let the desktop app install the plugin
via `/plugin marketplace add x96x64/ctxjev`, distinct from the CLI-only `--plugin-dir`. Added it,
and — unlike several "should work per the docs" moments earlier in this project — it worked on
the first try: `/plugin marketplace add x96x64/ctxjev` succeeded from the desktop app itself, and
`/ctxjev:set-goal`/`/ctxjev:status` showed up as available skills in that same session. Not yet
separately confirmed: the hooks (`PreCompact`/`SessionStart`) firing through a marketplace install
specifically, as opposed to `--plugin-dir` — no real compaction has been forced to check (see
Phase 5's note on why that's deliberately not being spent without asking first).
[`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) was also filled out past the
bare minimum (`displayName`, `keywords`, `category`, `repository`, `homepage`, `license`,
`author`) and passes `claude plugin validate .` cleanly.

## Phase 9 — A Codex plugin bundle, verified for real (v0.1.2, 2026-09-21)

Turns out Codex has its own plugin marketplace too (launched 2026-03-27, separate from Claude
Code's) — bundles of skills, app integrations, and MCP servers, shared across the ChatGPT/Codex
desktop app, CLI, and IDE extensions. Two paths: submit to OpenAI's reviewed public directory, or
distribute from a repo with zero review via `$REPO_ROOT/.agents/plugins/marketplace.json`. Since
`ctxjev` has no Codex-specific lifecycle hooks to offer (Codex doesn't have anything like
`PreCompact`/`SessionStart` — those are Claude Code–specific events), the only thing worth
bundling for Codex is the existing `ctxjev-mcp` server, exposed the same way `codex mcp add`
already does it manually.

Added, following the documented [Agent Plugins](https://agent-plugins.org) schema (`1.0.0`):
[`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json) →
[`plugins/ctxjev/plugin.json`](plugins/ctxjev/plugin.json) +
[`plugins/ctxjev/mcp.json`](plugins/ctxjev/mcp.json) (stdio, `npx ctxjev-mcp`,
`TYPESAFE_API_KEY` from the environment).

**Fully verified with a real, freshly-installed `codex-cli`, not left at "should work per spec":**

```
codex plugin marketplace add x96x64/ctxjev   # → Added marketplace `ctxjev-plugins`
codex plugin add ctxjev@ctxjev-plugins       # → Added plugin `ctxjev` ... installed, enabled 0.1.2
codex mcp list                                # → ctxjev  npx  ctxjev-mcp  env: PLUGIN_DATA=..., PLUGIN_ROOT=..., TYPESAFE_API_KEY=...
```

One real snag on the way: the very first `codex plugin marketplace add x96x64/ctxjev` resolved to
the *Claude Code* marketplace (`.claude-plugin/marketplace.json`, pointing at
`packages/claude-plugin`) instead of the new Codex-specific one — not because Codex prefers that
file, but because the new `.agents/plugins/marketplace.json` hadn't been pushed to GitHub yet at
that moment. `codex plugin marketplace upgrade ctxjev-plugins` after pushing picked up the right
file immediately. A reminder that "verify for real" has to happen *after* the remote state
actually matches local, not before.

Also confirmed `codex plugin add <name>` requires the fully-qualified `<name>@<marketplace>` form
when more than one marketplace is configured — a bare name is refused, not silently ambiguous.

## Phase 10 — Self-audit: three real bugs, found by actually trying to break it (v0.1.4-0.1.6, 2026-09-21)

Asked directly: "how far along is this, really, and what's actually wrong with it?" Answering that
honestly meant reading every non-test source file in the monorepo (970 lines total — small enough
to read in full) and then trying to break the result, not just re-reading the happy path.

**Found and fixed, each confirmed against the live API before and after:**

- **`inferGoalFromEntries()` picked up `/compact` itself as the goal (v0.1.4).** `PreCompact` fires
  right after `/compact` runs, so the "most recent user message" fallback — the whole point of
  which is to guess what the session was actually about — was, in the single most common way
  `PreCompact` fires, just the literal string `"/compact"`. Confirmed against this repo's own
  cached `preserved-context.json` from an earlier real compaction. Fixed by skipping any user
  entry that's itself a slash command (bare or the wrapped `<command-name>` form) and continuing
  to look backward.
- **The MCP server reported `version: '0.0.0'`, hardcoded, forever (v0.1.5).** The exact same
  stale-string bug already fixed for `ctxjev-cli --version` in Phase 8, just never applied to
  `server.ts`'s own `McpServer` registration. Any MCP client inspecting server info would never
  see the real version. Fixed the same way: read it from the package's own `package.json`.
- **Duplicate entry ids silently corrupted scores (v0.1.6).** `scoreRelevance()` keys `state.entries`
  by `entry.id`; two entries sharing an id meant the second's content silently overwrote the
  first's in what Jev actually saw, and both then got mapped back to the same verdict — no error,
  no warning, just a wrong score returned as if it were right. Reproduced with a deliberately
  crafted transcript before fixing it: `scoreEntries()` now rejects duplicate ids up front, before
  any entry reaches Jev.
- **An invalid `--drop-below`/`--summarize-below` value silently went to `NaN` (v0.1.6).**
  `score < NaN` is always `false`, so a typo'd threshold didn't error — it just meant `decideAction`
  could never return `'drop'` again, changing every entry's outcome with no indication anything
  was wrong. Reproduced live (`--drop-below notanumber` zeroed out every drop in a run that should
  have had two), then fixed: both flags are now validated as real numbers in `[0, 1]` and reported
  as a clear error, using the same "report every problem at once" path Phase 5 already established.

**Added while looking for more of the above — a real fix, not a hypothetical one:** re-running the
same sample transcript against Jev repeatedly (exactly what today's testing did, dozens of times)
was re-paying for identical judgments every single time. `scoreEntries()`/`pruneContext()` now
accept an optional `cache: ScoreCache` (a plain `get`/`set` interface, so `ctxjev-core` stays
host-agnostic about where results live), checked before and populated after each Jev request, keyed
by goal + entry content rather than entry id or transcript. `ctxjev-cli` wires this to a JSON file
at `~/.cache/ctxjev/score-cache.json` by default, with `--no-cache` to bypass it. Verified live:
identical input reports `usage: { inputTokens: 0, outputTokens: 0 }` on the second run.

**Also deduplicated, not just fixed:** `ctxjev-cli` and `ctxjev-mcp`'s `tools.ts` had each
reimplemented the exact same `JevUsage`-accumulation closure independently — moved into
`ctxjev-core` as `createUsageAccumulator()`, per this project's own stated rule that logic more
than one adapter needs belongs in `core`, not copied into each.

**What this pass did *not* find anything wrong with, after real testing:** chunking across the
50-entries-per-request boundary (verified with 55 entries — no id collisions, no lost entries,
correct chunk-crossing ordering), all CLI error paths (missing file, wrong JSON shape, no goal,
missing key + bad path reported together, empty `entries` array short-circuiting without an API
call), and every package's dependency list (nothing unused).

**Closed since (v0.1.8):** the `PreCompact` → `SessionStart` hook pair has now run end-to-end
through a fresh marketplace install and a real `/compact` in a live session. Getting there found
two packaging bugs that only a real install could: `dist/` wasn't committed (0.1.7), and the hook
imported `ctxjev-core` by bare name, which never resolves in an installed copy (0.1.8, fixed by
bundling with esbuild).

## Phase 11 — Review round: what the integrations actually do (v0.2.0, 2026-09-23)

A big-picture review, after three rounds of line-level audits, found the largest problems weren't
bugs but a mismatch between what the README promised and what each integration can do, plus a few
things that made the plugin less useful or less safe than it looked.

- **Privacy.** The plugin sends excerpts of users' real sessions to Jev by design, while this
  repo's own `CLAUDE.md` warned that real transcripts contain secrets. Every Jev request now goes
  through `redactSecrets()`; `.ctxjev/` is created with its own `.gitignore`; every README that
  covers a path sending content to Jev says so.
- **Plugin quality.** Tool entries now say what was called (`Bash(npm test): …`) instead of only
  the tool name; excerpts went from 300 to 600 characters; only entries since the last compaction
  are scored; an explicit goal applies to its own session only; the goal's source message no
  longer takes a preserved slot; and every run's outcome is recorded for `/ctxjev:status`, so a
  missing key is no longer indistinguishable from "working".
- **Honest numbers.** Savings no longer count `summarize` as saved — the README's sample went from
  "39% saved" to the true 21% (plus a separate summarize-candidate figure).
- **Scoring.** Every chunk sees the batch's latest activity (cross-chunk supersession); an offline
  keyword scorer works with no key, labeled wherever it's used; the eval gained two new fixtures,
  a top-K metric, and an offline baseline.
- **Positioning.** The README leads with what each package actually does. The MCP server's
  structural limit (it can't change host context, and sending history as tool arguments costs the
  host model tokens) is stated up front rather than implied away.
- **Process.** CI fails if the committed plugin bundle is stale; release policy lives in
  `CLAUDE.md`; the CHANGELOG is one line per change.

**What the eval found:** with the offline baseline in place, Jev and keyword overlap *tied* on
all three existing fixtures (61/73 each) — those fixtures' relevant entries reuse the goal's own
words, so they couldn't show whether Jev adds anything. A fourth fixture,
`session-logout.json`, describes the real cause without any of the goal's words and fills the
distractors with them: keyword overlap got 1 of its top 5 right, Jev got 5 of 5, and aggregate
drop accuracy is 83% (Jev) vs. 78% (keywords) over 101 labels. `recencyWeight = 0.1` held up
again: Jev ties from 0 to 0.1 and degrades from 0.2. The live regression test (never drop an entry
labeled relevant) passes on all four fixtures with the new chunk-context prompt.

