# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

`ctxjev` — a context-pruning toolkit for long-running AI agents, built on TypeSafe AI's Jev
(a fast/cheap "System One" model that returns typed decisions, not text). See [README.md](README.md)
for the pitch and [ROADMAP.md](ROADMAP.md) for phased scope.

## Structure

pnpm workspace monorepo. `packages/core` and `packages/cli` have real, working logic verified
against the live Jev API; `packages/mcp-server` and `packages/claude-plugin` are still
placeholders (Phase 2/3 — see [ROADMAP.md](ROADMAP.md)). Don't build those out ahead of schedule;
each just wraps `core`, so there's nothing for them to do until there's a reason to prefer one
integration surface's exact shape over another.

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
```

`TYPESAFE_API_KEY` (from `console.typesafe.ai/settings/keys`) must be set for anything that
actually calls Jev — `scoreRelevance()`/`pruneContext()` and the CLI's `analyze` command. It's
kept in `.env.local` at the repo root (gitignored, never commit it) — `source .env.local` before
running anything live. `--help`/`--version` and the pure-logic test files don't need it; the one
exception, `packages/core/src/jevClient.live.test.ts`, is skipped automatically when the key is
absent rather than failing.
