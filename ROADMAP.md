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
- Test fixtures: [`examples/sample-transcripts`](examples/sample-transcripts) — currently one
  hand-written transcript; redacted excerpts from real Claude Code session `.jsonl` logs are messier
  and worth adding once the policy/scoring logic is stable enough that fixture churn isn't wasted effort.

- **Composite scoring** ✅: `scoreEntries()` blends Jev's relevance with each entry's recency within the
  batch (oldest=0, newest=1 — see [`recency.ts`](packages/core/src/recency.ts)) per
  `PruningPolicy.recencyWeight`, producing a `combinedScore` that `pruneContext()` actually acts on.
  `scoreEntries()` and `pruneContext()` are now separate exports — the MCP server's two planned tools map
  onto them directly (`score_relevance` → `scoreEntries`, `prune_history` → `pruneContext`).

## Phase 2 — MCP server ✅
- `packages/mcp-server`: `score_relevance` (wraps `scoreEntries` — scores only, no decision) and
  `prune_history` (wraps `pruneContext` — scores plus the keep/drop/summarize decision and a savings
  report) as MCP tools, registered via `McpServer.registerTool` with zod input schemas
  ([`schemas.ts`](packages/mcp-server/src/schemas.ts)).
- Verified two ways: an in-process client/server test over `InMemoryTransport`
  ([`server.live.test.ts`](packages/mcp-server/src/server.live.test.ts)) exercising the real MCP
  wiring, and a manual real-subprocess run over actual stdio (`StdioServerTransport`/
  `StdioClientTransport`) — both pass against the live Jev API.
- A project-level [`.mcp.json`](.mcp.json) now wires `ctxjev` into any Claude Code session opened
  in this repo (`${TYPESAFE_API_KEY}` expanded from the environment Claude Code itself was
  launched in — no secret in the committed file). **Not yet verified**: MCP servers load at
  session start, so this needs a fresh Claude Code session (with the key actually exported first)
  to confirm the tools show up for real — proving that is still open, and is a precondition for
  assuming Codex/Copilot will "just work" too.

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
- Verified end-to-end against a synthetic transcript (real `preCompact.js`/`sessionStartCompact.js`
  subprocesses, piped fake stdin, against the live Jev API) — **not yet against a real Claude Code
  session**, for the same reason as Phase 2's `.mcp.json`: this requires a fresh session with the
  key exported, which this development session can't do to itself.

## Phase 4 — Further hosts (research spikes before committing)
- **Codex CLI**, **GitHub Copilot**: both are plausible MCP-server consumers — confirm each host's current
  MCP support before building a dedicated adapter; if MCP works, `packages/mcp-server` may need no changes
  at all.
- **Xcode**: no confirmed general-purpose third-party AI/MCP extension surface as of this writing — spike
  first, don't commit to an adapter package until that's verified.
