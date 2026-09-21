<div align="center">

# ctxjev

**Stop paying to re-read your own agent's history.**

`ctxjev` scores every entry in a running AI agent's context for relevance with
[Jev](https://typesafe.ai) — TypeSafe AI's typed-decision model — and prunes what's no longer
useful, before your host's own compaction has to summarize its way through it.

[![npm (ctxjev-cli)](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm (ctxjev-core)](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm (ctxjev-mcp)](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-F69220?logo=pnpm&logoColor=white)](pnpm-workspace.yaml)
[![status: early development](https://img.shields.io/badge/status-early%20development-orange)](ROADMAP.md)

[Why](#why) · [How it works](#how-it-works) · [Quick start](#quick-start) · [Packages](#packages) · [MCP](#using-it-from-an-mcp-host) · [Claude Code plugin](#the-claude-code-plugin) · [Design notes](#design-notes) · [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md)

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

  e1  bash       summarize  score 0.48  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       summarize  score 0.26  read package.json — saw the dependency list and script names
  e3  grep       keep       score 0.89  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       drop       score 0.14  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.93  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.94  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       drop       score 0.14  ran: ls public/audio — unrelated, was checking something el…

3 kept, 2 summarized, 2 dropped (of 7 entries)
~60 / 154 tokens saved (39%)
Jev cost: 859 input tokens, 123 output tokens (free) — ~$0.000036
```

*(real output, against the sample transcript in this repo — Jev is probabilistic, so exact numbers
will vary slightly between runs. "score" is Jev's relevance blended with each entry's recency
within the batch — see [Design notes](#design-notes). The cost line is computed from what Jev's
API actually reported using that request, not estimated.)*

`ctxjev analyze` also accepts a real Claude Code session transcript directly — point it at a
`.jsonl` file (`transcript_path`, or anything under `~/.claude/projects`) instead of ctxjev's own
format, and the goal is inferred from your most recent chat message unless `--goal` overrides it.
See [`examples/sample-transcripts/claude-code-session.jsonl`](examples/sample-transcripts/claude-code-session.jsonl)
for a synthetic one — **never point this at a real session log**, since real ones can contain
secrets pasted into chat and entry content gets sent to the live Jev API (see
[`CLAUDE.md`](CLAUDE.md)).

## Quick start

```bash
npm install -g ctxjev-cli
export TYPESAFE_API_KEY=...   # console.typesafe.ai/settings/keys — no waitlist

ctxjev analyze transcript.jsonl --goal "Fix the checkout double-charge bug."
```

Or from a clone, to run the exact sample transcript below:

```bash
git clone https://github.com/x96x64/ctxjev.git
cd ctxjev
pnpm install && pnpm build

export TYPESAFE_API_KEY=...
node packages/cli/dist/index.js analyze examples/sample-transcripts/checkout-bug.json
```

## Packages

This is a pnpm workspace monorepo: one host-agnostic engine, and a thin adapter per place that
engine gets used.

| Package | What it is | Status |
| --- | --- | --- |
| [`ctxjev-core`](packages/core) ([npm](https://www.npmjs.com/package/ctxjev-core)) | The engine — `pruneContext(entries, goal, policy)`. Everything else wraps this. | ✅ published |
| [`ctxjev-cli`](packages/cli) ([npm](https://www.npmjs.com/package/ctxjev-cli)) | `ctxjev analyze <transcript.json>` — a plain-text report, no UI. | ✅ published |
| [`ctxjev-mcp`](packages/mcp-server) ([npm](https://www.npmjs.com/package/ctxjev-mcp)) | MCP server exposing `score_relevance`/`prune_history` as tools, for Claude Code, Codex, GitHub Copilot, and other MCP-capable hosts. | ✅ published |
| [`ctxjev-claude`](packages/claude-plugin) | Claude Code plugin: scores context with Jev at `PreCompact` and re-injects a digest at `SessionStart`, plus two inspection skills. | ✅ working (not on npm — see below) |

See [`ROADMAP.md`](ROADMAP.md) for the phase-by-phase plan, including why an Xcode adapter is a
research spike rather than a commitment.

## Using it from an MCP host

`ctxjev-mcp` speaks plain stdio MCP — no per-host adapter turned out to be necessary. Every host
below runs the exact same binary (`node packages/mcp-server/dist/index.js`); only the config
shape differs.

**Claude Code** — this repo ships a project-level [`.mcp.json`](.mcp.json), but in practice that
scope needed an approval step that never surfaced for us (Claude Code v2.1.278) — `claude mcp
list` just silently omitted the server, with no prompt and no error. `claude mcp add` (local
scope) worked immediately with no friction:

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- node /absolute/path/to/ctxjev/packages/mcp-server/dist/index.js
```

If you go this route in a repo that already has the project-level `.mcp.json`, `claude mcp list`
will warn about the same server being defined in two scopes — harmless for a local stdio server
(the warning is really about OAuth token storage, which doesn't apply here), but
`claude mcp remove ctxjev -s project` clears the noise if it bothers you.

**Codex CLI** (also shared with its VS Code extension and desktop app) — one command, no file to
hand-edit. Verified for real against `codex-cli` v0.155.1 (`codex mcp get ctxjev` confirms the
command/args/env registered correctly):

```bash
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- node /absolute/path/to/ctxjev/packages/mcp-server/dist/index.js
```

**GitHub Copilot** (VS Code, agent mode) — `.vscode/mcp.json`. Note the top-level key is
`servers`, not Claude Code's `mcpServers`:

```json
{
  "servers": {
    "ctxjev": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/ctxjev/packages/mcp-server/dist/index.js"],
      "env": { "TYPESAFE_API_KEY": "..." }
    }
  }
}
```

*(Xcode is a deliberate absence here — see [ROADMAP.md](ROADMAP.md)'s Phase 4. It turned out to be
an MCP* server *exposing Xcode's own tools to agents like Claude Code/Codex, not a client that
would consume a third-party server like this one.)*

It exposes two tools:

- **`score_relevance`** — `{ goal, entries, recencyWeight? }` → a relevance/recency/combined score
  per entry plus Jev token usage, no decision made. Wraps `scoreEntries()`.
- **`prune_history`** — the same input plus `{ dropBelow?, summarizeBelow? }` → a decision
  (`keep`/`drop`/`summarize`) per entry, a savings report, and Jev token usage. Wraps `pruneContext()`.

Calling `prune_history` with two entries — one obviously relevant to the goal, one not — returns:

```json
{
  "decisions": [
    { "entryId": "a", "relevance": 0.96, "recency": 0, "combinedScore": 0.864, "action": "keep" },
    { "entryId": "b", "relevance": 0.04, "recency": 1, "combinedScore": 0.136, "action": "drop" }
  ],
  "savings": {
    "totalEntries": 2, "keptEntries": 1, "droppedEntries": 1, "summarizedEntries": 0,
    "totalTokens": 13, "savedTokens": 5
  },
  "usage": { "inputTokens": 406, "outputTokens": 36 }
}
```

*(real response body, captured against the live API via an in-process MCP client — the exact
call is [`server.live.test.ts`](packages/mcp-server/src/server.live.test.ts).)*

## The Claude Code plugin

Claude Code hooks can *read* the conversation transcript but **cannot rewrite it** — there's no
API for a hook to reach in and drop old entries before compaction summarizes them away. So
`ctxjev-claude` doesn't try to. It uses the pattern Claude Code actually supports: score at
`PreCompact`, cache the highest-relevance entries, and re-inject a digest of them at
`SessionStart` (`matcher: "compact"`) — the one documented way a hook can put content back into
context once compaction has already smoothed over what was there.

```
PreCompact  → score every entry with Jev, cache the top few to .ctxjev/preserved-context.json
  (compaction happens — out of this plugin's control)
SessionStart (compact) → read that cache, print a digest — Claude Code adds it as a system reminder
```

The goal to score against is either set explicitly (`/ctxjev:set-goal <text>`, written to
`.ctxjev/goal.txt`) or, if you never set one, inferred from your most recent chat message.
`/ctxjev:status` shows the current goal and the last scoring pass without waiting for a real
compaction to trigger one.

Try it locally with `claude --plugin-dir packages/claude-plugin`. This repo's own
[`.mcp.json`](.mcp.json) also wires `ctxjev-mcp` (see above) into any Claude Code session opened
here — both are how this project dogfoods itself.

`ctxjev-claude` isn't on npm — Claude Code plugins aren't npm-installed, and the desktop app has no
way to load a local plugin folder at all (only the CLI's `--plugin-dir` does). It stays in this
repo, `private: true`, until it's worth packaging for a marketplace.

## Design notes

- **Claude Code's transcript parser lives in `core`, isolated, on purpose.**
  [`claudeCodeTranscript.ts`](packages/core/src/claudeCodeTranscript.ts) parses Claude Code's own
  internal session-log format — undocumented, and not guaranteed stable across versions. It moved
  here from `packages/claude-plugin` once `ctxjev-cli` needed it too: both packages import the same
  function rather than each keeping (and drifting from) their own copy. Keeping every bit of that
  parsing in one module means a Claude Code update that changes the format is a one-file fix, not a
  hunt across two packages. It's also the reason `packages/claude-plugin`'s original design — a
  hook that edits the transcript directly — doesn't exist: hooks only get read access to it (see
  [ROADMAP.md](ROADMAP.md)'s Phase 3 for what that ruled out and what replaced it). A subagent's
  own private conversation (`isSidechain: true`) is excluded entirely, not merged in — that content
  already appears in the main thread as an ordinary tool call, so including it too would score
  content outside what the parent session's compaction actually operates on (a real bug this
  parser had until Phase 5).
- **No hand-rolled retry logic.** `@typesafe-ai/sdk`'s `TypeSafeClient` already retries connection
  failures, timeouts, and 408/429/500-599 responses by default — adding our own would just be a
  worse copy of what the SDK does correctly. Checked, not assumed (see
  [`jevClient.ts`](packages/core/src/jevClient.ts)).
- **Every cost claim here is measured, not estimated.** `scoreEntries()`/`pruneContext()` accept an
  optional `onUsage` callback fired once per underlying Jev request with that request's real
  `{ inputTokens, outputTokens }` (`@typesafe-ai/sdk`'s own reported usage) — `ctxjev-cli` and both
  MCP tools surface the total. Adding this as an optional callback rather than changing the return
  type kept it non-breaking.
- **Scoring and deciding are two different functions, on purpose.**
  [`scoreEntries()`](packages/core/src/index.ts) calls Jev once per chunk of entries and returns a
  `relevance`/`recency`/`combinedScore` triple per entry — no opinion about what to do with it.
  [`pruneContext()`](packages/core/src/index.ts) is `scoreEntries()` plus a separate, pure decision
  step ([`decideAction()`](packages/core/src/policy.ts)) that applies a `PruningPolicy`'s
  thresholds. Splitting them means a threshold can be tuned, swapped for a different strategy, or
  applied to the *same* scores twice for comparison — all without re-querying Jev. It's also why
  the MCP server has two tools instead of one: `score_relevance` maps onto `scoreEntries()`,
  `prune_history` onto `pruneContext()`, and neither has to know the other exists.
- **Recency is relative to the batch, not to `Date.now()`.**
  [`computeRecency()`](packages/core/src/recency.ts) normalizes each entry's timestamp to 0–1
  *within the entries it's given* (oldest → 0, newest → 1). Anchoring to wall-clock time instead
  would make every entry in a transcript replayed long after the fact — which is exactly what
  `ctxjev-cli analyze` and the test fixtures do — read as maximally stale regardless of where it
  actually falls in the conversation. The same function has to give sensible answers for both a
  live agent's growing history and a static file being analyzed after the fact, so it can't
  depend on when it happens to run.
- **`combinedScore` blends the two linearly**, per `PruningPolicy.recencyWeight`
  (`relevance * (1 - w) + recency * w`, [`combineScore()`](packages/core/src/policy.ts)) — a
  weight of `0` ignores recency entirely and a weight of `1` ignores Jev entirely. The default
  (`0.1`) is now backed by [an actual sweep](packages/core/eval/run.mjs) against two hand-labeled
  fixtures, one of them deliberately adversarial (a root-cause entry that's both early *and*
  critical): accuracy ties from `w=0` to `w=0.2`, but the adversarial fixture starts degrading
  right at `w=0.2` as recency drags that entry's score down despite Jev rating it highly relevant.
  `0.1` sits on the safe side of that cliff for free — see
  [`recencyWeight.live.test.ts`](packages/core/src/recencyWeight.live.test.ts), which turns that
  finding into a standing regression test. Two fixtures is still thin evidence for tuning
  `dropBelow`/`summarizeBelow` themselves — see [ROADMAP.md](ROADMAP.md) for why those stay
  untouched for now.
- **Token counts are computed, not judged.** [`tokenEstimate.ts`](packages/core/src/tokenEstimate.ts)
  uses a real tokenizer ([`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer)) — Jev is
  explicitly bad at arithmetic, so this project doesn't ask it to count anything. Every "tokens
  saved" number in this README came from that tokenizer, not from Jev.
- **The MCP server is verified two ways.** `tools.live.test.ts` covers the underlying logic
  directly (no MCP framework involved); `server.live.test.ts` spins up the real `McpServer`
  against an in-process client over `InMemoryTransport` to exercise the actual tool registration,
  zod schemas, and response shape. Both were also run once as a genuine subprocess over real
  stdio (`StdioServerTransport` ↔ `StdioClientTransport`) during development — the same transport
  path a host like Claude Code would use — though that run isn't part of the automated suite.
- **Live tests are opt-in.** Every test file ending in `.live.test.ts` across all four packages
  (`core`'s `jevClient`/`recencyWeight`, `mcp-server`'s `tools`/`server`, `claude-plugin`'s
  `select`) calls the real Jev API and is skipped automatically when `TYPESAFE_API_KEY` isn't set
  — cloning this repo and running `pnpm test` with no key still passes, on the pure-logic coverage
  alone. CI never sets the key, so it's exercising exactly that path on every push.
- **Never run anything here against this repo's own real Claude Code session transcripts.** They
  can contain secrets pasted into chat, and scoring sends entry content to the live Jev API — see
  the warning in [`CLAUDE.md`](CLAUDE.md). Use a synthetic transcript instead.

## Contributing

Early days — issues and PRs welcome, but expect the API surface to move until `packages/core`
settles, especially around `PruningPolicy` and how recency weighting works (see
[Design notes](#design-notes) above).

Before opening a PR:

```bash
pnpm install && pnpm build && pnpm test
```

`pnpm test` alone is enough to validate a change that doesn't touch Jev-calling code — the
pure-logic suite (chunking, policy math, recency, savings, transcript parsing, goal/cache
handling, report formatting) runs with no key and no network access. If your change *does* touch
`jevClient.ts`, `tools.ts`, `server.ts`, or `select.ts`, get a free key at
[console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys) and export
`TYPESAFE_API_KEY` first so the corresponding `.live.test.ts` suite actually runs instead of
skipping — a PR that only touches those files without a live test run passing locally is likely to
get asked to re-run with a key before review.

If your change touches `PruningPolicy` defaults or the scoring/recency blend specifically, add a
labeled fixture to [`examples/sample-transcripts`](examples/sample-transcripts) (a `groundTruth`
field, same shape as the existing two) and run the sweep before opening a PR:

```bash
cd packages/core && pnpm eval
```

A PR that changes `DEFAULT_POLICY` without new sweep numbers to back it up is going back to
"deliberately simple starting point, not tuned" — which is exactly the state this project moved
away from once. Adding a fixture is cheap; regressing the honesty of that default isn't.

## Acknowledgments

Built on [Jev](https://typesafe.ai), TypeSafe AI's System One model, via the official
[`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk). `ctxjev-mcp` is built on
Anthropic's [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).
`ctxjev` is an independent, unofficial project — not affiliated with or endorsed by TypeSafe AI or
Anthropic.

## License

[MIT](LICENSE) — do what you like with this code, including in a commercial product, as long as
the license text and copyright notice in [`LICENSE`](LICENSE) ship with it. There's no warranty of
any kind; see the license text for the full disclaimer.

This choice matches every package `ctxjev` currently depends on, so there's nothing to reconcile
if you vendor or fork any of it:

| Dependency | License |
| --- | --- |
| [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) | MIT |
| [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | MIT |
| [`zod`](https://www.npmjs.com/package/zod) | MIT |
| [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) | MIT |
| [`picocolors`](https://www.npmjs.com/package/picocolors) | ISC |

(ISC and MIT are both short, permissive licenses with no material difference in what they let you
do — picocolors is just one of the few things here that happens to use ISC's slightly older
wording instead of MIT's.)
