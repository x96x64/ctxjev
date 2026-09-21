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

**Not yet done, deliberately deferred**: composite scoring (Jev's relevance alone drives the decision
right now — no importance/recency weighting yet, even though `PruningPolicy.recencyWeight` exists as a
field). Adding that without real transcripts to tune against would just be guessing at weights.

## Phase 2 — MCP server
- `packages/mcp-server`: `score_relevance` (score a batch of entries against a goal) and `prune_history`
  (apply a policy, return the pruned history + a savings report) as MCP tools.
- Verify end-to-end against Claude Code itself via a local `.mcp.json` entry before assuming any other host
  works.

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
