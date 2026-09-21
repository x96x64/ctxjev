# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

`ctxjev` — a context-pruning toolkit for long-running AI agents, built on TypeSafe AI's Jev
(a fast/cheap "System One" model that returns typed decisions, not text). See [README.md](README.md)
for the pitch and [ROADMAP.md](ROADMAP.md) for phased scope.

## Structure

pnpm workspace monorepo. `packages/core`, `packages/cli`, and `packages/mcp-server` have real,
working logic verified against the live Jev API; `packages/claude-plugin` is still a placeholder
(Phase 3 — see [ROADMAP.md](ROADMAP.md)). `core` exports two entry points that matter here:
`scoreEntries()` (relevance + recency, no decision) and `pruneContext()` (`scoreEntries()` plus
applying a `PruningPolicy`'s thresholds) — both `ctxjev-cli` and `ctxjev-mcp` are thin adapters
over these two functions, nothing more. Don't add logic to an adapter package that belongs in
`core` instead.

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
```

`TYPESAFE_API_KEY` (from `console.typesafe.ai/settings/keys`) must be set for anything that
actually calls Jev — `scoreRelevance()`/`pruneContext()`, the CLI's `analyze` command, and the MCP
server's two tools. It's kept in `.env.local` at the repo root (gitignored, never commit it) —
`source .env.local` before running anything live. `--help`/`--version` and the pure-logic test
files don't need it; every test file whose name ends in `.live.test.ts` (`packages/core`'s
`jevClient.live.test.ts`, `packages/mcp-server`'s `tools.test.ts`/`server.live.test.ts`) is skipped
automatically when the key is absent rather than failing.
