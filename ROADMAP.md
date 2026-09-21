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

## Phase 4 — Further hosts ✅ (research spike complete, 2026-09-21)

- **Codex CLI**: real, generic stdio MCP client support (also shared with the VS Code extension and
  desktop app via one `config.toml`). Registering `ctxjev-mcp` is one command:
  `codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- node packages/mcp-server/dist/index.js`.
  **No adapter package needed** — `packages/mcp-server` already works as-is. See the README's
  "Using it from an MCP host" section for the exact command.
- **GitHub Copilot** (agent mode, GA since 2026-07): also a generic stdio MCP client, configured via
  `.vscode/mcp.json`'s `servers` key (note: `servers`, not Claude Code's `mcpServers`). **No adapter
  package needed** here either — same `packages/mcp-server` binary, different config file.
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
