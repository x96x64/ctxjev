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
- **Not yet done**: an actual `.mcp.json` entry wiring this into a real Claude Code session — the
  subprocess test above proves the same transport path Claude Code would use, but hasn't been
  confirmed inside Claude Code itself. Do that before assuming Codex/Copilot will "just work" too.

## Phase 3 — Claude Code plugin
- `packages/claude-plugin`: a hook that runs pruning before Claude Code's own compaction kicks in, and a
  skill for manually inspecting/triggering a prune mid-session.
- Dogfood on real sessions.

## Phase 4 — Further hosts (research spikes before committing)
- **Codex CLI**, **GitHub Copilot**: both are plausible MCP-server consumers — confirm each host's current
  MCP support before building a dedicated adapter; if MCP works, `packages/mcp-server` may need no changes
  at all.
- **Xcode**: no confirmed general-purpose third-party AI/MCP extension surface as of this writing — spike
  first, don't commit to an adapter package until that's verified.
