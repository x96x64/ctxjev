<div align="center">

# ctxjev

**Stop paying to re-read your own agent's history.**

`ctxjev` scores every entry in a running AI agent's context for relevance with
[Jev](https://typesafe.ai) — TypeSafe AI's typed-decision model — and prunes what's no longer
useful, before your host's own compaction has to summarize its way through it.

[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-F69220?logo=pnpm&logoColor=white)](pnpm-workspace.yaml)
[![status: early development](https://img.shields.io/badge/status-early%20development-orange)](ROADMAP.md)

[Why](#why) · [How it works](#how-it-works) · [Quick start](#quick-start) · [Packages](#packages) · [Roadmap](ROADMAP.md)

</div>

---

## Why

Long-running agent loops — coding agents, browser agents, anything with a growing tool-call
history — accumulate context faster than it stays useful. Most of that history isn't hard to
judge: *"is this old tool result still relevant to the current task?"* is exactly the kind of
fast, cheap, structured decision [Jev](https://typesafe.ai) is built for — a decision model that
returns typed judgments (a yes/no probability, a choice, a score) in ~100ms instead of writing a
sentence about it.

`ctxjev` asks Jev that question continuously, so an agent's context stays close to what it
actually needs — before a host's own summarization has to compress its way through everything at
once, discarding nuance along with the noise.

> Jev can't see images, do arithmetic, or generate text. `ctxjev` never asks it to — token
> counting happens in code, and the keep/drop/summarize decision is a plain threshold applied to
> Jev's typed output. See [`CLAUDE.md`](CLAUDE.md) for the full list of things this project
> deliberately never asks Jev to do.

## How it works

Every entry becomes its own question, and every question in a batch is evaluated **in parallel
against one shared state** — Jev's cost barely grows with the number of questions, so scoring 50
tool-call entries costs about the same as scoring one.

```ts
import { pruneContext } from 'ctxjev-core'

const decisions = await pruneContext(
  entries, // your agent's tool-call / message history
  'Fix a bug where checkout charges customers twice on a slow network retry.',
)
```

```console
$ ctxjev analyze examples/sample-transcripts/checkout-bug.json

  e1  bash       summarize  relevance 0.51  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       summarize  relevance 0.28  read package.json — saw the dependency list and script…
  e3  grep       keep       relevance 0.95  grep "charge" in src/payments.ts — found chargeCustomer…
  e4  bash       drop       relevance 0.10  ran: git log --oneline -5 — recent commits about unrela…
  e5  read       keep       relevance 0.96  read src/payments.ts — the retry handler re-calls charg…
  e6  assistant  keep       relevance 0.95  Found it: the retry path doesn't check for an in-flight…
  e7  bash       drop       relevance 0.04  ran: ls public/audio — unrelated, was checking something…

3 kept, 2 summarized, 2 dropped (of 7 entries)
~60 / 154 tokens saved (39%)
```

*(real output, against the sample transcript in this repo — Jev is probabilistic, so exact numbers
will vary slightly between runs.)*

## Quick start

```bash
git clone https://github.com/x96x64/ctxjev.git
cd ctxjev
pnpm install && pnpm build

export TYPESAFE_API_KEY=...   # console.typesafe.ai/settings/keys — no waitlist
node packages/cli/dist/index.js analyze examples/sample-transcripts/checkout-bug.json
```

None of the packages are published to npm yet (see [Packages](#packages) and
[status](ROADMAP.md)) — for now, run them from a clone as above.

## Packages

This is a pnpm workspace monorepo: one host-agnostic engine, and a thin adapter per place that
engine gets used.

| Package | What it is | Status |
| --- | --- | --- |
| [`ctxjev-core`](packages/core) | The engine — `pruneContext(entries, goal, policy)`. Everything else wraps this. | ✅ working |
| [`ctxjev-cli`](packages/cli) | `ctxjev analyze <transcript.json>` — a plain-text report, no UI. | ✅ working |
| [`ctxjev-mcp`](packages/mcp-server) | MCP server exposing `score_relevance`/`prune_history` as tools, for Claude Code, Codex, GitHub Copilot, and other MCP-capable hosts. | 🚧 planned |
| [`ctxjev-claude`](packages/claude-plugin) | Claude Code–specific plugin: a hook that prunes ahead of Claude Code's own compaction, plus an on-demand inspection skill. | 🚧 planned |

See [`ROADMAP.md`](ROADMAP.md) for the phase-by-phase plan, including why an Xcode adapter is a
research spike rather than a commitment.

## Design notes

- **The engine never touches the network policy layer.** `pruneContext` calls Jev once per chunk
  of entries and returns raw relevance scores; turning a score into keep/drop/summarize is a
  separate, pure function ([`policy.ts`](packages/core/src/policy.ts)) so the threshold can be
  tuned — or swapped for a different strategy entirely — without touching the Jev integration.
- **Token counts are computed, not judged.** [`tokenEstimate.ts`](packages/core/src/tokenEstimate.ts)
  uses a real tokenizer ([`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer)) — Jev is
  explicitly bad at arithmetic, so this project doesn't ask it to count anything.
- **Live tests are opt-in.** `packages/core`'s test suite includes one integration test that
  calls the real Jev API — it's skipped automatically unless `TYPESAFE_API_KEY` is set, so cloning
  this repo and running `pnpm test` with no key still passes on the pure-logic coverage alone.

## Contributing

Early days — issues and PRs welcome, but expect the API surface to move until `packages/core`
settles. Run `pnpm install && pnpm build && pnpm test` before opening a PR.

## Acknowledgments

Built on [Jev](https://typesafe.ai), TypeSafe AI's System One model. `ctxjev` is an independent,
unofficial project — not affiliated with or endorsed by TypeSafe AI.

## License

[MIT](LICENSE)
