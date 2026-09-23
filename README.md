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

[Why](#why) · [Choosing a Package](#choosing-a-package) · [Claude Code Plugin](#the-claude-code-plugin) · [How Scoring Works](#how-scoring-works) · [Does It Work?](#does-it-work) · [Quick Start](#quick-start) · [MCP Hosts](#using-it-from-an-mcp-host) · [Design Notes](#design-notes) · [Changelog](CHANGELOG.md)

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
| Drop stale history in an agent loop you control | [`ctxjev-core`](packages/core) | `pruneMessages()` takes an Anthropic Messages conversation and returns it with stale entries removed (or cut to fit a token budget), every `tool_use`/`tool_result` pair kept intact, and reports what that costs a prompt cache. For other formats, `pruneContext()` returns keep/drop/summarize per entry. |
| See how a transcript would score, or prune a saved one | [`ctxjev-cli`](packages/cli) | `analyze` prints a report; `prune` writes the transcript back out with drops removed. |
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
import { pruneMessages } from 'ctxjev-core'

// `messages` is the Anthropic Messages conversation your agent loop sends each turn.
const { messages: pruned, removed } = await pruneMessages(
  messages,
  'Fix a bug where checkout charges customers twice on a slow network retry.',
)
// `pruned` is still a valid request: tool_use/tool_result pairs are removed together, and the
// first message and the latest turn are never touched.
```

Any other history shape works through `pruneContext(entries, goal)`, which takes plain
`{ id, role, toolName?, content, timestamp }` entries and returns a decision per entry.

```console
$ ctxjev analyze examples/sample-transcripts/checkout-bug.json

  e1  bash       summarize  score 0.52  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       drop       score 0.27  read package.json — saw the dependency list and script names
  e3  grep       keep       score 0.84  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       drop       score 0.15  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.89  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.90  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       drop       score 0.15  ran: ls public/audio — unrelated, was checking something el…

3 kept, 1 summarized, 3 dropped (of 7 entries)
~44 / 154 tokens saved by dropping (29%), plus ~16 in entries marked summarize (savings there depend on your summarizer)
Jev cost: 1,290 input tokens, 123 output tokens (free) — ~$0.000054
```

This is real output against the sample transcript in this repo. Jev is probabilistic, so exact
numbers vary slightly between runs. "Score" is Jev's relevance blended with each entry's recency
within the batch, described further in [Design Notes](#design-notes). The cost line is computed
from what Jev's API actually reported for that request, not estimated. Only dropped entries count
as saved. Jev doesn't generate text, so what `summarize` saves depends on what you do with those
entries: `ctxjev prune --summarize-excerpts` cuts them to their head and tail, and
`pruneMessages()` can also hand them to your own summarizer.

The `entries` array above is the one shape every agent's history maps onto, regardless of host.
`ctxjev analyze` also auto-detects a real Claude Code session `.jsonl` and infers the goal from
your most recent chat message unless `--goal` overrides it. See
[`examples/sample-transcripts/claude-code-session.jsonl`](examples/sample-transcripts/claude-code-session.jsonl)
for a synthetic one. **Be careful pointing it at a real session log**: entry content is sent to the
live Jev API, and although common secret formats are masked first, that masking can't catch
everything.

## Does It Work?

Three evals, each run on a **held-out set** that was never used for tuning:
[`examples/eval-sessions`](examples/eval-sessions), 10 coding sessions (6 English, 4 Japanese).

- **Written sessions (5).** Written by hand, with raw tool output: multi-line test logs, stack
  traces, diffs, installer noise, and 5k-token logs. They include dead ends that were later reverted,
  and distractors that share the goal's words.
- **Recorded sessions (5).** Real Claude Code sessions, recorded on throwaway task repos in
  [`examples/eval-tasks`](examples/eval-tasks). Each task has a planted bug. The user states
  constraints partway through ("banker's rounding", "keep the full-width tilde"), and the session
  ends with the fix.

Each session lists the facts the task still needs later, with the entries that state them.

**1. Do the facts survive?** Each session is squeezed into a token budget with
`pruneMessages({ targetTokens })`, and we count how many of those facts are still there. This is the
mean of 3 Jev runs, and every release is gated on it (`eval/run.mjs --gate --runs 3`).

| Ranking by | 50% budget | 25% budget |
| --- | --- | --- |
| **Jev** | **94%** | **86%** |
| Newest first (plain truncation) | 79% | 64% |
| Keyword overlap (offline) | 76% | 61% |
| Random | 69% | 61% |

**2. Can a model still answer from what's left?** [`eval/outcome.mjs`](packages/core/eval/outcome.mjs)
has Claude Haiku 4.5 answer each fact as a question from the pruned conversation, and Claude
Sonnet 5 grade the answer. That's 69 questions, 2 runs, about $3.50 a run.

| Context given to the model | 50% budget | 25% budget |
| --- | --- | --- |
| Everything (nothing removed) | 93% | 93% |
| **Pruned by Jev** | **88%** | **78%** |
| Plain truncation (newest kept) | 80% | 67% |
| Pruned by keyword overlap | 67% | 62% |
| Only the task (guessing) | 0% | 0% |

**3. Can an agent still finish the job?** [`eval/tasks.mjs`](packages/core/eval/tasks.mjs) cuts
each recorded session before "now implement the fix". It prunes that history to 25% of its tokens
and gives Claude Haiku 4.5 the fix request, with real tools in a fresh copy of the repo. Success
means the task's hidden acceptance tests pass, and those tests include the constraints the user
stated mid-session. That's 5 tasks, 2 runs each, $2.38 for all 50 runs.

| History given to the agent | Tasks passed |
| --- | --- |
| Everything | 100% |
| **Pruned to 25% by Jev** | **90%** |
| Pruned to 25%, newest kept | 80% |
| Pruned to 25% by keyword overlap | 70% |
| Only the task | 30% |

The failures are the interesting part:

- **Where the misses were:** all but one miss under pruning was on the webhook task: Jev's one,
  both of truncation's, and two of keyword overlap's three. We re-ran truncation there with failing test
  names recorded. Its history had lost the message where the user said "keep the mark for 24
  hours", so the agent picked its own TTL instead of re-reading the docs.
- **The agent with only the task passed that task:** with no history at all, it investigated from
  scratch and found the 24-hour window in the provider's docs. So a partial history can be worse
  than none, when it looks complete but has lost a constraint.
- **Truncation on the recorded sessions:** at a 50% budget, truncation keeps as many facts as Jev
  there (100% vs 94%), because a real agent restates its findings near the end. It falls behind
  when the budget is tight (77% vs 90% at 25%).

On the same held-out set, Jev's keep/drop matches the labels 74% of the time (keywords: 52%), and
puts only relevant entries in every session's top 5, the part the Claude Code plugin re-injects. On
the dev fixtures it was tuned on, it's 90%.

What this doesn't show:

- The tasks are small, and 5 tasks × 2 runs is a small sample.
- The agent is Claude Haiku 4.5, not the model you'd run in production.
- The recorded sessions come from one recording model (Claude Sonnet 5) on tasks written for this
  eval.
- Token counts come from `gpt-tokenizer`, an approximation of Claude's tokenizer.

Every answer, verdict, and agent run is in
[`eval/results/`](packages/core/eval/results).

## Quick Start

```bash
npm install -g ctxjev-cli
export TYPESAFE_API_KEY=...   # console.typesafe.ai/settings/keys (no waitlist)

ctxjev analyze transcript.jsonl --goal "Fix the checkout double-charge bug."
```

No key yet? `--offline` scores by keyword overlap instead: nothing is sent, and the results are
much cruder, but it shows the shape of the output.

`ctxjev prune` writes a ctxjev-format or Anthropic Messages transcript back out with the drops
removed (to stdout, or `--out <file>`):

```bash
ctxjev prune examples/sample-transcripts/anthropic-messages.json --out pruned.json
```

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
| [`ctxjev-core`](packages/core) ([npm](https://www.npmjs.com/package/ctxjev-core)) | The engine: `scoreEntries()`/`pruneContext()`/`pruneMessages()`, plus the Claude Code transcript parser, secret masking, and the offline scorer. Everything else wraps this. | ✅ published |
| [`ctxjev-cli`](packages/cli) ([npm](https://www.npmjs.com/package/ctxjev-cli)) | `ctxjev analyze` (a report) and `ctxjev prune` (the transcript with drops removed). | ✅ published |
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
- **Savings only count what's actually removed, at its real size.** `summarizeSavings()` reports
  `droppedTokens` separately from `summarizableTokens`, since what `summarize` saves depends on
  what you do with it. Both count each entry's `sourceTokens`, the size of the full payload, not
  the 600-character excerpt that gets scored. Before 0.3.1 they counted the excerpt, which made a
  45,000-token log look like ~200 tokens.
- **Pruning a conversation keeps it a valid request.** In the Anthropic Messages API, a
  `tool_result` without its `tool_use` (or the reverse) is rejected, so
  [`pruneMessages()`](packages/core/src/anthropicMessages.ts) scores a tool call and its result as
  one entry and removes them together. It never touches the first message (the original task) or
  the latest turn, which may hold a tool call still waiting on its result. Pruning also changes
  every request after the first removed message, so a prompt cache starts over there. The result
  reports `cache.invalidatedTokens`, and `minSavedTokens` skips a change too small to pay for that.
  See [prompt caching](packages/core/README.md#with-prompt-caching).
- **The scorer is pluggable.** `scorer` takes `'jev'`, `'local'`, or your own function, which is
  called per chunk like Jev and gets content that `redactSecrets()` has already masked.
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
  keeps that as a regression test. `dropBelow` went from 0.25 to 0.3 in 0.4.0: on the dev
  fixtures, Jev keeps every relevant entry up to 0.4, but the held-out sessions start losing
  relevant entries at 0.35. So 0.3 is the highest value that loses none on either set, and it
  raises accuracy by 4-6 points. `summarizeBelow` keeps its original default.
- **Jev has to beat a keyword baseline, and does — where it matters.** The eval always runs the
  offline scorer alongside Jev. On fixtures whose relevant entries share the goal's words, the two
  tie. On [`session-logout.json`](examples/sample-transcripts/session-logout.json), where the real
  cause (a token-renewal race) never uses the goal's words and the distractors do ("user", "app",
  "log out"), keyword overlap put 1 relevant entry in its top 5 and Jev put 5. A Japanese fixture,
  [`invoice-date-ja.json`](examples/sample-transcripts/invoice-date-ja.json), is built the same
  way: keywords got 3 of its top 5 and Jev 5. See [Does It Work?](#does-it-work) for the held-out
  numbers. Every release is gated on this: `publish.yml` runs `eval/run.mjs --gate --runs 3`,
  which fails if Jev's mean accuracy falls below the baseline's, it misses more than one of any
  fixture's top entries, or it keeps fewer of the held-out facts under a 50% budget than plain
  truncation or keywords do.
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
