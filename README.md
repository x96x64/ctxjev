<div align="center">

# ctxjev

**Keep what matters when your agent's context gets compacted.**

`ctxjev` scores each entry in an AI agent's history for relevance to the current goal, using
[Jev](https://typesafe.ai), TypeSafe AI's typed-decision model, or an offline keyword heuristic
when there's no API key. In Claude Code, it carries the most relevant details through compaction.
In an agent loop you write yourself, it tells you what's safe to drop.

[![npm (ctxjev-cli)](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm (ctxjev-core)](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm (ctxjev-mcp)](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-F69220?logo=pnpm&logoColor=white)](pnpm-workspace.yaml)

[Why](#why) · [Choosing a Package](#choosing-a-package) · [Claude Code Plugin](#the-claude-code-plugin) · [How Scoring Works](#how-scoring-works) · [Quick Start](#quick-start) · [MCP Hosts](#using-it-from-an-mcp-host) · [Design Notes](#design-notes) · [Changelog](CHANGELOG.md)

</div>

---

## Why

Long-running agents accumulate context faster than it stays useful, and hosts deal with that by
compacting: summarizing the whole history at once. A summary is lossy by nature. The one line that
turned out to be the bug can get smoothed away along with everything that didn't matter.

Most of that history is easy to judge: *"is this old tool result still relevant to the current
task?"* is exactly the kind of fast, cheap, structured decision Jev is built for. It returns typed
judgments (a yes/no probability, a choice, a score) in about 100ms instead of writing a sentence
about it.

`ctxjev` asks that question about every entry. What it can do with the answer depends on where it
runs. A host like Claude Code doesn't let anything remove entries from its context, so there
`ctxjev` works alongside compaction and hands the most relevant entries back once it's done. An
agent loop you write yourself owns its message list, so there you can drop what scored low before
it's ever sent to the model again.

> Jev can't see images, do arithmetic, or generate text. `ctxjev` never asks it to: token counting
> happens in code, and the keep/drop/summarize decision is a plain threshold applied to Jev's
> typed output. See [`CLAUDE.md`](CLAUDE.md) for the full list of things this project deliberately
> never asks Jev to do.

## Choosing a Package

| You want to… | Use | What it actually does |
| --- | --- | --- |
| Keep key details through Claude Code's compaction | [`ctxjev-claude`](#the-claude-code-plugin) plugin | Scores the session right before compaction and re-injects the top few entries right after. Adds a short reminder; doesn't remove anything. |
| Drop stale history in an agent loop you control | [`ctxjev-core`](packages/core) | Returns keep/drop/summarize per entry. You remove what it says to drop from your own message list. |
| See how a transcript would score before wiring anything up | [`ctxjev-cli`](packages/cli) | Prints a report. Analysis only: it doesn't modify the transcript. |
| Expose scoring as a tool to an MCP host | [`ctxjev-mcp`](packages/mcp-server) | Returns scores to whoever calls the tool. [Read the caveat](#using-it-from-an-mcp-host) before expecting it to save tokens. |

## The Claude Code Plugin

Claude Code hooks can *read* the conversation transcript but can't rewrite it: there is no API for
a hook to remove old entries before compaction summarizes them away. `ctxjev-claude` works within
that constraint, using the one pattern Claude Code supports: score every entry at `PreCompact`,
cache the highest-relevance ones, and re-inject a digest of them at `SessionStart`
(`matcher: "compact"`), the documented way a hook can put content back into context after
compaction has already run.

```
PreCompact             → score entries since the last compaction; cache the top few in .ctxjev/
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a digest; Claude Code adds it as a system reminder
```

Tool entries carry what was called (`Bash(npm test): 12 passed`, `Read(src/payments.ts): …`), so
both the scoring and the reminder know which command or file a result came from. Only what's still
in context counts: anything before the previous compaction is skipped.

The goal to score against is either set explicitly with `/ctxjev:set-goal <text>`, which applies
to the current session only, or inferred from your most recent chat message. `/ctxjev:status`
shows what the last run did, including why if it skipped, failed, or fell back to offline scoring.

> **Privacy:** on every compaction, the plugin sends excerpts of your real session to TypeSafe AI's
> Jev API. Common secret formats are masked to `[REDACTED]` first (best-effort, not exhaustive),
> and the local `.ctxjev/` cache is created with its own `.gitignore` so it can't be committed.
> Without `TYPESAFE_API_KEY`, it scores offline by keyword overlap instead and sends nothing. See
> the plugin's [Privacy section](packages/claude-plugin/README.md#privacy) for exactly what's sent.

**Install it (Claude Code desktop app or CLI):**

```
/plugin marketplace add x96x64/ctxjev
```

This repo carries a [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) at its
root, pointing at the `packages/claude-plugin` subdirectory, so the desktop app can install it
directly with no local clone needed. `ctxjev-claude` isn't on npm; Claude Code plugins install
through the marketplace, not `npm install`. See the [plugin README](packages/claude-plugin/README.md)
for setup details, including how to make the key visible to the desktop app.

## How Scoring Works

Every entry becomes its own question, and every question in a batch is evaluated **in parallel
against one shared state**, so Jev's cost barely grows with the number of questions: scoring 50
tool-call entries costs about the same as scoring one.

```ts
import { pruneContext } from 'ctxjev-core'

const decisions = await pruneContext(
  entries, // your agent's tool-call / message history
  'Fix a bug where checkout charges customers twice on a slow network retry.',
)
// Drop what came back as "drop" from your own message list before the next model call.
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
~33 / 154 tokens saved by dropping (21%), plus ~27 in entries marked summarize (savings there depend on your summarizer)
Jev cost: 859 input tokens, 123 output tokens (free) — ~$0.000036
```

This is real output against the sample transcript in this repo. Jev is probabilistic, so exact
numbers vary slightly between runs. "Score" is Jev's relevance blended with each entry's recency
within the batch, described further in [Design Notes](#design-notes). The cost line is computed
from what Jev's API actually reported for that request, not estimated. Only dropped entries count
as saved: `ctxjev` can't summarize (Jev doesn't generate text), so what `summarize` saves depends
on whatever summarizer you use.

The `entries` array above is the one shape every agent's history maps onto, regardless of host.
`ctxjev analyze` also auto-detects a real Claude Code session `.jsonl` and infers the goal from
your most recent chat message unless `--goal` overrides it. See
[`examples/sample-transcripts/claude-code-session.jsonl`](examples/sample-transcripts/claude-code-session.jsonl)
for a synthetic one. **Be careful pointing it at a real session log**: entry content is sent to the
live Jev API, and although common secret formats are masked first, that masking can't catch
everything.

## Quick Start

```bash
npm install -g ctxjev-cli
export TYPESAFE_API_KEY=...   # console.typesafe.ai/settings/keys (no waitlist)

ctxjev analyze transcript.jsonl --goal "Fix the checkout double-charge bug."
```

No key yet? `--offline` scores by keyword overlap instead: nothing is sent, and the results are
much cruder, but it shows the shape of the output.

```bash
ctxjev analyze transcript.jsonl --goal "Fix the checkout double-charge bug." --offline
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
| [`ctxjev-core`](packages/core) ([npm](https://www.npmjs.com/package/ctxjev-core)) | The engine: `scoreEntries()`/`pruneContext()`, plus the Claude Code transcript parser, secret masking, and the offline scorer. Everything else wraps this. | ✅ published |
| [`ctxjev-cli`](packages/cli) ([npm](https://www.npmjs.com/package/ctxjev-cli)) | `ctxjev analyze <transcript>`: a plain-text (or `--json`) report. Doesn't modify anything. | ✅ published |
| [`ctxjev-mcp`](packages/mcp-server) ([npm](https://www.npmjs.com/package/ctxjev-mcp)) | MCP server exposing `score_relevance`/`prune_history` as tools. | ✅ published |
| [`ctxjev-claude`](packages/claude-plugin) | Claude Code plugin: scores at `PreCompact`, re-injects a digest at `SessionStart`, plus two inspection skills. | ✅ working (not on npm) |

## Using It from an MCP Host

**Read this first.** An MCP tool returns data to whoever called it; it can't remove anything from
the host's own context. And to score its history, the agent has to send that history *as tool
arguments*, which the host model pays for in its own output tokens. So in a host like Claude Code,
Codex, or Copilot, calling `prune_history` doesn't save tokens by itself. It's useful when
something acts on the scores: an agent framework that manages its own context and exposes tools, or
a workflow where knowing what's stale matters more than the cost of asking. For Claude Code
specifically, the [plugin](#the-claude-code-plugin) is the integration that actually helps.

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
    "totalTokens": 13, "droppedTokens": 5, "summarizableTokens": 0
  },
  "usage": { "inputTokens": 406, "outputTokens": 36 }
}
```

This is a real response, captured against the live API through an in-process MCP client. The
exact call lives in [`server.live.test.ts`](packages/mcp-server/src/server.live.test.ts).

## Design Notes

- **Claude Code's transcript parser lives in `core`, isolated, on purpose.**
  [`claudeCodeTranscript.ts`](packages/core/src/claudeCodeTranscript.ts) parses Claude Code's own
  internal session-log format, which is undocumented and not guaranteed stable across versions. It
  lives in `core` because `ctxjev-cli` needs it too, and keeping all of that parsing in one module
  means a format change is a one-file fix. It only returns what's still in context: a compaction
  boundary (a `compact_boundary` record, or the "This session is being continued…" summary that
  follows one) resets the list. A subagent's own private conversation (`isSidechain: true`) is
  excluded, since its result already appears in the main thread as an ordinary tool call.
- **Every chunk sees the latest activity.** Entries are scored in chunks of 50, and each chunk's
  shared state also carries the batch's most recent entries. Without that, an old failing test and
  the later run that fixed it could land in different chunks, and the old failure would be judged
  with no way to see it had been superseded.
- **Secrets are masked before anything leaves the machine.** Every Jev request is built in one
  place, [`buildJevRequest()`](packages/core/src/jevClient.ts), which runs goal and content through
  [`redactSecrets()`](packages/core/src/redact.ts) first. It recognizes common key and token
  formats and credential-named assignments. Best-effort, not a guarantee.
- **There's an offline fallback, and it's labeled as one.** `scorer: 'local'`
  ([`localRelevance.ts`](packages/core/src/localRelevance.ts)) scores by keyword overlap with the
  goal: no key, no network, much cruder. The plugin falls back to it when there's no key or Jev
  fails, and says so; the CLI exposes it as `--offline`. Its scores never go into the Jev score
  cache.
- **Savings only count what's actually removed.** `summarizeSavings()` reports `droppedTokens`
  separately from `summarizableTokens`. `ctxjev` can't summarize, so counting `summarize` as saved
  would claim savings that depend entirely on someone else's summarizer.
- **No hand-rolled retry logic.** `@typesafe-ai/sdk`'s `TypeSafeClient` already retries connection
  failures, timeouts, and 408/429/500-599 responses by default, so adding a custom retry layer
  would just be a worse copy of what the SDK already does correctly. Across chunks, requests run
  at most 5 at a time.
- **Every cost claim here is measured, not estimated.** `scoreEntries()`/`pruneContext()` accept an
  optional `onUsage` callback, fired once per underlying Jev request with that request's real
  `{ inputTokens, outputTokens }` as reported by `@typesafe-ai/sdk`. `ctxjev-cli` and both MCP tools
  surface the total.
- **Scoring and deciding are two different functions, on purpose.**
  [`scoreEntries()`](packages/core/src/index.ts) returns a `relevance`/`recency`/`combinedScore`
  triple per entry, with no opinion about what to do with it.
  [`pruneContext()`](packages/core/src/index.ts) adds a separate, pure decision step,
  [`decideAction()`](packages/core/src/policy.ts), that applies a `PruningPolicy`'s thresholds.
  Splitting them means a threshold can be tuned or applied to the same scores twice for
  comparison, all without re-querying Jev. It's also why the MCP server has two tools.
- **Recency is relative to the batch, not to `Date.now()`.**
  [`computeRecency()`](packages/core/src/recency.ts) normalizes each entry's timestamp to 0–1
  within the entries it's given, oldest at 0 and newest at 1. Anchoring to wall-clock time would
  make every entry in a transcript analyzed after the fact read as maximally stale, regardless of
  where it actually falls in the conversation.
- **`combinedScore` blends the two linearly**, per `PruningPolicy.recencyWeight`:
  `relevance * (1 - w) + recency * w`, in [`combineScore()`](packages/core/src/policy.ts). The
  default (`0.1`) came from [a sweep](packages/core/eval/run.mjs) against hand-labeled fixtures,
  one of them deliberately adversarial: a root-cause entry that's both early and critical. Accuracy
  tied from `w=0` to `w=0.2`, but the adversarial fixture started degrading at `w=0.2`, so `0.1`
  sits on the safe side. [`recencyWeight.live.test.ts`](packages/core/src/recencyWeight.live.test.ts)
  keeps that as a regression test. The eval now also covers a 60-entry fixture that spans two
  chunks and includes a ruled-out hypothesis, reports precision@5 (the plugin's actual output),
  and always runs the offline scorer as a baseline that Jev has to beat. The drop/summarize
  thresholds keep their original, untuned defaults until there's more labeled data.
- **Token counts are computed, not judged.** [`tokenEstimate.ts`](packages/core/src/tokenEstimate.ts)
  uses a real tokenizer, [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer), since Jev
  is explicitly bad at arithmetic and this project never asks it to count anything.
- **The MCP server is verified two ways.** `tools.live.test.ts` covers the underlying logic
  directly. `server.live.test.ts` spins up the real `McpServer` against an in-process client over
  `InMemoryTransport` to exercise the actual tool registration, zod schemas, and response shape.
- **Live tests are opt-in.** Every test file ending in `.live.test.ts` calls the real Jev API and
  is skipped automatically when `TYPESAFE_API_KEY` isn't set, so `pnpm test` passes on a fresh
  clone with no key. The plugin's hooks are also tested as the actual bundled `dist/` files, run
  as subprocesses, the way Claude Code runs them.

## Contributing

Issues and pull requests are welcome.

```bash
pnpm install && pnpm build && pnpm test
```

`pnpm test` runs the full pure-logic suite with no API key and no network access. Tests that call
the live Jev API end in `.live.test.ts` and are skipped automatically unless `TYPESAFE_API_KEY` is
set. If you change anything under `packages/core/src` or `packages/claude-plugin/src`, commit the
rebuilt `packages/claude-plugin/dist/` too; CI checks that it matches. When developing, use the
synthetic transcripts in [`examples/sample-transcripts`](examples/sample-transcripts), never a
real session log (see [`CLAUDE.md`](CLAUDE.md)).

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
