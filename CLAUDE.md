# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

`ctxjev` — a context-pruning toolkit for long-running AI agents, built on TypeSafe AI's Jev
(a fast/cheap "System One" model that returns typed decisions, not text). See [README.md](README.md)
for the pitch and [ROADMAP.md](ROADMAP.md) for phased scope.

## Structure

pnpm workspace monorepo. `packages/core`, `packages/cli`, `packages/mcp-server`, and
`packages/claude-plugin` all have real, working logic verified against the live Jev API (see
[ROADMAP.md](ROADMAP.md) for what "verified" means for each — a couple of things are only proven
via a synthetic/subprocess test). `core` exports the pieces every other package is a thin adapter
over: `scoreEntries()`/`pruneContext()` (relevance+recency scoring, with or without the
keep/drop/summarize decision), and `parseClaudeCodeTranscript()`/`inferGoalFromEntries()` (parsing
Claude Code's own session log format — used by both `ctxjev-cli` and `ctxjev-claude`, which is why
it lives in `core` rather than either of them). Don't add logic to an adapter package that belongs
in `core` instead.

**Claude Code hooks cannot rewrite the transcript** — this constrained `packages/claude-plugin`'s
whole design (see the Phase 3 section of [ROADMAP.md](ROADMAP.md) for what was tried first and
ruled out). A hook can only read the transcript and, on specific events, print text to stdout that
Claude Code adds back to context. Don't design a feature here around a hook mutating past
conversation content — it can't.

## Jev constraints (don't design around what it can't do)

- Text/structured input only — no images, audio, video.
- No arithmetic or counting — do that in code (e.g. tiktoken for token counts), never ask Jev to compute it.
- No free text generation — every call is a `noul` (yes/no probability), `choice` (pick from ≤255 options
  with a probability distribution), or `score` (position on a 2-10 scale) question against a shared state.
- Each request can fan out many independent questions against one shared state cheaply — batch entries
  into a chunk rather than one request per entry (see `packages/core/src/chunk.ts`).

## Commands

```bash
pnpm install && pnpm build   # build every package (tsc -b), from the repo root
pnpm test                    # run every package's tests, recursing via pnpm -r
node packages/cli/dist/index.js analyze <transcript.json> --goal "..."
node packages/mcp-server/dist/index.js   # stdio MCP server — expects an MCP client, not a terminal

# Simulate what Claude Code's hooks actually send a plugin script over stdin:
echo '{"cwd":"...","transcript_path":"..."}' | node packages/claude-plugin/dist/preCompact.js
echo '{"cwd":"..."}' | node packages/claude-plugin/dist/sessionStartCompact.js

cd packages/core && pnpm eval   # sweep recencyWeight against examples/sample-transcripts' groundTruth
```

`TYPESAFE_API_KEY` (from `console.typesafe.ai/settings/keys`) must be set for anything that
actually calls Jev — `scoreRelevance()`/`pruneContext()`, the CLI's `analyze` command, the MCP
server's two tools, and `packages/claude-plugin`'s `PreCompact` hook. It's kept in `.env.local` at
the repo root (gitignored, never commit it) — `source .env.local` before running anything live.
`--help`/`--version` and the pure-logic test files don't need it; every test file whose name ends
in `.live.test.ts` (in `core`, `mcp-server`, and `claude-plugin` — `cli` has none) is skipped
automatically when the key is absent rather than failing. CI only sets the key for the publish
workflow's test step.

**When developing or testing, never run any of this against real session transcripts**
(`~/.claude/projects/*/*.jsonl`) — they can contain secrets pasted into chat (this project's own
history does, from setting up `TYPESAFE_API_KEY` originally), and `preCompact.js`/`selectPreserved`
and `ctxjev-cli analyze` send entry content to the live Jev API. Use a synthetic fixture instead
(see `packages/core/src/claudeCodeTranscript.test.ts` for the shape, or
`examples/sample-transcripts/claude-code-session.jsonl` for a ready-made one). The *shipped*
plugin does score its users' real transcripts — that's its purpose — which is why every request
goes through `redactSecrets()` (`packages/core/src/redact.ts`) and the plugin README discloses it.
Any new path that sends content to Jev must go through `buildJevRequest()` in `jevClient.ts` so it
inherits that masking.

`parseClaudeCodeTranscript()` skips `isSidechain: true` records (a subagent's own private
conversation) — that content already shows up in the main thread as an ordinary
tool_use/tool_result pair, so including the sidechain too would double up on it and score content
that was never part of what the parent session's compaction actually operates on.
