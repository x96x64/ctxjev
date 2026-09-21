<div align="center">

# ctxjev

**Stop paying to re-read your own agent's history.**

`ctxjev` scores every entry in a running AI agent's context for relevance with
[Jev](https://typesafe.ai), TypeSafe AI's typed-decision model, and prunes what's no longer useful
before your host's own compaction has to summarize its way through it.

[![npm (ctxjev-cli)](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm (ctxjev-core)](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm (ctxjev-mcp)](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-F69220?logo=pnpm&logoColor=white)](pnpm-workspace.yaml)

[Why](#why) · [How It Works](#how-it-works) · [Quick Start](#quick-start) · [Packages](#packages) · [MCP: Claude Code / Codex / Copilot](#using-it-from-an-mcp-host) · [Extra: Claude Code Plugin](#the-claude-code-plugin) · [Design Notes](#design-notes) · [Changelog](CHANGELOG.md)

</div>

---

## Why

Long-running agent loops, such as coding agents, browser agents, or anything with a growing
tool-call history, accumulate context faster than it stays useful. Most of that history isn't hard to
judge: *"is this old tool result still relevant to the current task?"* is exactly the kind of
fast, cheap, structured decision Jev is built for, a decision model that returns typed judgments
(a yes/no probability, a choice, a score) in about 100ms instead of writing a sentence about it.

`ctxjev` asks Jev that question continuously, so an agent's context stays close to what it
actually needs, before a host's own summarization has to compress its way through everything at
once and discard nuance along with the noise.

> Jev can't see images, do arithmetic, or generate text. `ctxjev` never asks it to: token counting
> happens in code, and the keep/drop/summarize decision is a plain threshold applied to Jev's
> typed output. See [`CLAUDE.md`](CLAUDE.md) for the full list of things this project deliberately
> never asks Jev to do.

## How It Works

Every entry becomes its own question, and every question in a batch is evaluated **in parallel
against one shared state**, so Jev's cost barely grows with the number of questions: scoring 50
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

This is real output against the sample transcript in this repo. Jev is probabilistic, so exact
numbers vary slightly between runs. "Score" is Jev's relevance blended with each entry's recency
within the batch, described further in [Design Notes](#design-notes). The cost line is computed
from what Jev's API actually reported for that request, not estimated.

The `entries` array above is the one shape every agent's history maps onto, regardless of which
host is running it: Claude Code, Codex, GitHub Copilot, or anything else that keeps a tool-call
history. `ctxjev analyze` also auto-detects one native format today, a real Claude Code session
`.jsonl` (`transcript_path`, or anything under `~/.claude/projects`), and infers the goal from your
most recent chat message unless `--goal` overrides it. Any other host's history works the same
way once it's shaped into ctxjev's own plain JSON format (`{ goal?, entries }`), shown in
[Quick Start](#quick-start) below. See
[`examples/sample-transcripts/claude-code-session.jsonl`](examples/sample-transcripts/claude-code-session.jsonl)
for a synthetic Claude Code transcript. **Never point this at a real session log**: real ones can
contain secrets pasted into chat, and entry content is sent to the live Jev API. See
[`CLAUDE.md`](CLAUDE.md).

## Quick Start

```bash
npm install -g ctxjev-cli
export TYPESAFE_API_KEY=...   # console.typesafe.ai/settings/keys (no waitlist)

ctxjev analyze transcript.jsonl --goal "Fix the checkout double-charge bug."
```

Or from a clone, to run the exact sample transcript above:

```bash
git clone https://github.com/x96x64/ctxjev.git
cd ctxjev
pnpm install && pnpm build

export TYPESAFE_API_KEY=...
node packages/cli/dist/index.js analyze examples/sample-transcripts/checkout-bug.json
```

## Packages

This is a pnpm workspace monorepo: one host-agnostic engine, and a thin adapter for each place
that engine gets used.

| Package | What it is | Status |
| --- | --- | --- |
| [`ctxjev-core`](packages/core) ([npm](https://www.npmjs.com/package/ctxjev-core)) | The engine: `pruneContext(entries, goal, policy)`. Everything else wraps this. | ✅ published |
| [`ctxjev-cli`](packages/cli) ([npm](https://www.npmjs.com/package/ctxjev-cli)) | `ctxjev analyze <transcript.json>`: a plain-text report, no UI. | ✅ published |
| [`ctxjev-mcp`](packages/mcp-server) ([npm](https://www.npmjs.com/package/ctxjev-mcp)) | MCP server exposing `score_relevance`/`prune_history` as tools, for Claude Code, Codex, GitHub Copilot, and other MCP-capable hosts. | ✅ published |
| [`ctxjev-claude`](packages/claude-plugin) | Claude Code plugin: scores context with Jev at `PreCompact` and re-injects a digest at `SessionStart`, plus two inspection skills. | ✅ working (not on npm; see below) |

## Using It from an MCP Host

`ctxjev-mcp` speaks plain stdio MCP, so no per-host adapter is necessary. Every host below runs
the exact same binary (`node packages/mcp-server/dist/index.js`); only the config shape differs.

**Claude Code** ships with a project-level [`.mcp.json`](.mcp.json) in this repo. In practice, that
scope requires an approval step that does not currently surface in the UI (tested against Claude
Code v2.1.278): `claude mcp list` silently omits the server, with no prompt and no error. `claude
mcp add` at local scope works immediately with no friction:

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- node /absolute/path/to/ctxjev/packages/mcp-server/dist/index.js
```

If you use this route in a repo that already has the project-level `.mcp.json`, `claude mcp list`
will warn that the same server is defined in two scopes. That warning concerns OAuth token
storage, which does not apply to a local stdio server, so it is safe to ignore, or run `claude mcp
remove ctxjev -s project` to clear it.

**Codex CLI** (also shared with its VS Code extension and desktop app) needs only one command, with
no file to hand-edit. Verified against `codex-cli` v0.155.1: `codex mcp get ctxjev` confirms the
command, args, and env are registered correctly.

```bash
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- node /absolute/path/to/ctxjev/packages/mcp-server/dist/index.js
```

Codex also has its own plugin marketplace, separate from Claude Code's. This repo carries an
[Agent Plugins](https://agent-plugins.org)-format bundle too, at
[`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json):

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

Afterward, `codex mcp list` shows `ctxjev` registered with the exact `npx ctxjev-mcp` command and
environment the plugin bundle declares.

**GitHub Copilot** (VS Code, agent mode) uses `.vscode/mcp.json`. Note that the top-level key is
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

It exposes two tools:

- **`score_relevance`** takes `{ goal, entries, recencyWeight? }` and returns a
  relevance/recency/combined score per entry plus Jev token usage, with no decision made. Wraps
  `scoreEntries()`.
- **`prune_history`** takes the same input plus `{ dropBelow?, summarizeBelow? }` and returns a
  decision (`keep`/`drop`/`summarize`) per entry, a savings report, and Jev token usage. Wraps
  `pruneContext()`.

Calling `prune_history` with two entries, one obviously relevant to the goal and one not, returns:

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

This is a real response, captured against the live API through an in-process MCP client. The
exact call lives in [`server.live.test.ts`](packages/mcp-server/src/server.live.test.ts).

## The Claude Code Plugin

Everything above (the MCP server, and `ctxjev-cli`) already works the same way with Claude Code,
Codex, GitHub Copilot, or any other MCP-capable host — none of it is Claude Code-specific. This
section is the one extra, host-specific integration `ctxjev` currently ships, because Claude Code
happens to expose a lifecycle hook the others don't yet: a way to act right before and right after
its own compaction runs.

Claude Code hooks can *read* the conversation transcript but cannot rewrite it: there is no API
for a hook to remove old entries before compaction summarizes them away. `ctxjev-claude` works
within that constraint rather than around it, using the one pattern Claude Code supports: score
every entry at `PreCompact`, cache the highest-relevance ones, and re-inject a digest of them at
`SessionStart` (`matcher: "compact"`), the only documented way a hook can put content back into
context after compaction has already run.

```
PreCompact  → score every entry with Jev, cache the top few to .ctxjev/preserved-context.json
  (compaction happens, outside this plugin's control)
SessionStart (compact) → read that cache, print a digest; Claude Code adds it as a system reminder
```

The goal to score against is either set explicitly (`/ctxjev:set-goal <text>`, written to
`.ctxjev/goal.txt`) or, if you never set one, inferred from your most recent chat message.
`/ctxjev:status` shows the current goal and the last scoring pass without waiting for a real
compaction to trigger one.

**Install it (Claude Code desktop app or CLI):**

```
/plugin marketplace add x96x64/ctxjev
```

This repo carries a [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) at its
root, pointing at the `packages/claude-plugin` subdirectory, so the desktop app can install it
directly with no local clone needed. Verified: `/ctxjev:set-goal` and `/ctxjev:status` show up as
available skills right after adding the marketplace.

`ctxjev-claude` isn't on npm; Claude Code plugins install through the marketplace mechanism above,
not `npm install`. This repo's own [`.mcp.json`](.mcp.json) also wires `ctxjev-mcp` into any Claude
Code session opened here, so this project uses its own tools on its own repository.

## Design Notes

- **Claude Code's transcript parser lives in `core`, isolated, on purpose.**
  [`claudeCodeTranscript.ts`](packages/core/src/claudeCodeTranscript.ts) parses Claude Code's own
  internal session-log format, which is undocumented and not guaranteed stable across versions. It
  lives in `core` rather than in `packages/claude-plugin` because `ctxjev-cli` needs it too: both
  packages import the same function instead of each keeping, and drifting from, their own copy.
  Keeping every bit of that parsing in one module means a Claude Code format change is a one-file
  fix rather than a hunt across two packages. It's also why `packages/claude-plugin` doesn't try to
  edit the transcript directly: hooks only get read access to it. A subagent's own private
  conversation (`isSidechain: true`) is excluded entirely rather than merged in, since that content
  already appears in the main thread as an ordinary tool call; merging it in would double-count
  content the parent session's compaction never actually operates on.
- **No hand-rolled retry logic.** `@typesafe-ai/sdk`'s `TypeSafeClient` already retries connection
  failures, timeouts, and 408/429/500-599 responses by default, so adding a custom retry layer
  would just be a worse copy of what the SDK already does correctly. See
  [`jevClient.ts`](packages/core/src/jevClient.ts).
- **Every cost claim here is measured, not estimated.** `scoreEntries()`/`pruneContext()` accept an
  optional `onUsage` callback, fired once per underlying Jev request with that request's real
  `{ inputTokens, outputTokens }` as reported by `@typesafe-ai/sdk`. `ctxjev-cli` and both MCP tools
  surface the total. Adding this as an optional callback rather than changing the return type kept
  it non-breaking.
- **Scoring and deciding are two different functions, on purpose.**
  [`scoreEntries()`](packages/core/src/index.ts) calls Jev once per chunk of entries and returns a
  `relevance`/`recency`/`combinedScore` triple per entry, with no opinion about what to do with it.
  [`pruneContext()`](packages/core/src/index.ts) is `scoreEntries()` plus a separate, pure decision
  step, [`decideAction()`](packages/core/src/policy.ts), that applies a `PruningPolicy`'s
  thresholds. Splitting them means a threshold can be tuned, swapped for a different strategy, or
  applied to the same scores twice for comparison, all without re-querying Jev. It's also why the
  MCP server has two tools instead of one: `score_relevance` maps onto `scoreEntries()`,
  `prune_history` onto `pruneContext()`, and neither has to know the other exists.
- **Recency is relative to the batch, not to `Date.now()`.**
  [`computeRecency()`](packages/core/src/recency.ts) normalizes each entry's timestamp to 0–1
  within the entries it's given, oldest at 0 and newest at 1. Anchoring to wall-clock time instead
  would make every entry in a transcript replayed long after the fact, which is exactly what
  `ctxjev-cli analyze` and the test fixtures do, read as maximally stale regardless of where it
  actually falls in the conversation. The same function has to give sensible answers for both a
  live agent's growing history and a static file analyzed after the fact, so it can't depend on
  when it happens to run.
- **`combinedScore` blends the two linearly**, per `PruningPolicy.recencyWeight`:
  `relevance * (1 - w) + recency * w`, in [`combineScore()`](packages/core/src/policy.ts). A weight
  of `0` ignores recency entirely, and a weight of `1` ignores Jev entirely. The default (`0.1`) is
  backed by [an actual sweep](packages/core/eval/run.mjs) against two hand-labeled fixtures, one of
  them deliberately adversarial: a root-cause entry that's both early and critical. Accuracy ties
  from `w=0` to `w=0.2`, but the adversarial fixture starts degrading right at `w=0.2`, as recency
  drags that entry's score down despite Jev rating it highly relevant. `0.1` sits safely on the
  near side of that cliff. See
  [`recencyWeight.live.test.ts`](packages/core/src/recencyWeight.live.test.ts), which turns that
  finding into a standing regression test. Two fixtures is still thin evidence for tuning
  `dropBelow`/`summarizeBelow` directly, so those thresholds keep their original, untuned defaults
  for now.
- **Token counts are computed, not judged.** [`tokenEstimate.ts`](packages/core/src/tokenEstimate.ts)
  uses a real tokenizer, [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer), since Jev
  is explicitly bad at arithmetic and this project never asks it to count anything. Every "tokens
  saved" number in this README came from that tokenizer, not from Jev.
- **The MCP server is verified two ways.** `tools.live.test.ts` covers the underlying logic
  directly, with no MCP framework involved. `server.live.test.ts` spins up the real `McpServer`
  against an in-process client over `InMemoryTransport` to exercise the actual tool registration,
  zod schemas, and response shape. Both were also verified once as a real subprocess over stdio
  (`StdioServerTransport` ↔ `StdioClientTransport`), the same transport path a host like Claude
  Code uses, though that run is not part of the automated suite.
- **Live tests are opt-in.** Every test file ending in `.live.test.ts` — `core`'s
  `jevClient`/`recencyWeight`, `mcp-server`'s `tools`/`server`, `claude-plugin`'s `select`
  (`cli` has none; its tests cover its own pure logic against a stubbed cache/transcript) — calls
  the real Jev API and is skipped automatically when `TYPESAFE_API_KEY` isn't set.
  Cloning this repo and running `pnpm test` with no key still passes, on the pure-logic coverage
  alone, and CI never sets the key, so it exercises exactly that path on every push.
- **Never run anything here against this repo's own real Claude Code session transcripts.** They
  can contain secrets pasted into chat, and scoring sends entry content to the live Jev API. See
  the warning in [`CLAUDE.md`](CLAUDE.md), and use a synthetic transcript instead.

## Contributing

Issues and pull requests are welcome.

```bash
pnpm install && pnpm build && pnpm test
```

`pnpm test` runs the full pure-logic suite with no API key and no network access. Tests that call
the live Jev API end in `.live.test.ts` and are skipped automatically unless `TYPESAFE_API_KEY` is
set.

## Acknowledgments

Built on [Jev](https://typesafe.ai), TypeSafe AI's System One model, via the official
[`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk). `ctxjev-mcp` is built on
Anthropic's [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).
`ctxjev` is an independent, unofficial project, not affiliated with or endorsed by TypeSafe AI or
Anthropic.

## License

This project is released under the [MIT](LICENSE) license: free to use, modify, and distribute,
including in a commercial product, as long as the license text and copyright notice in
[`LICENSE`](LICENSE) ship with it. It comes with no warranty of any kind; see the license text
for the full disclaimer.

This choice matches every package `ctxjev` currently depends on, so there is nothing to reconcile
if you vendor or fork any of it:

| Dependency | License |
| --- | --- |
| [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) | MIT |
| [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | MIT |
| [`zod`](https://www.npmjs.com/package/zod) | MIT |
| [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) | MIT |
| [`picocolors`](https://www.npmjs.com/package/picocolors) | ISC |

ISC and MIT are both short, permissive licenses with no material difference in what they let you
do.
