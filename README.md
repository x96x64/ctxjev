<div align="center">

# ctxjev

**Keep what matters when your agent's context gets compacted.**

`ctxjev` scores each entry in an AI agent's history for relevance to the current goal, offline by
default, or with [Jev](https://typesafe.ai), TypeSafe AI's typed-decision model, if you opt in. In Claude Code, it carries the most relevant details through compaction.
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
task?"* is the kind of fast, cheap, structured decision [Jev](https://typesafe.ai) is built for. It
returns typed judgments (a yes/no probability, a choice, a score) in about 100ms instead of writing
a sentence about it, so `ctxjev` can ask it about every entry cheaply.

What `ctxjev` does with the answer depends on where it runs. A host like Claude Code doesn't let
anything remove entries from its context, so there `ctxjev` works alongside compaction and hands
the most relevant entries back once it's done. An agent loop you write yourself owns its message
list, so there you can drop what scored low before it's ever sent to the model again.

> Jev can't see images, do arithmetic, or generate text. `ctxjev` never asks it to: token counting
> happens in code, and the keep/drop/summarize decision is a plain threshold applied to Jev's
> typed output. See [`CLAUDE.md`](CLAUDE.md) for the full list of things this project deliberately
> never asks Jev to do.

**Where things stand (2026-09-24).** A [preregistered comparison](packages/core/eval/PREREGISTRATION.md)
on six tasks Jev's ranking had never seen found no difference in whether the agent finished the
job: Jev and plain truncation both passed every task, on two models, [0, 0] points apart. So **the
default scorer is `'recency'` (plain truncation)** in `ctxjev-core`, `ctxjev-cli`, and
`pruneMessages()`; Jev is opt-in via `scorer: 'jev'`. Where Jev did separate itself — how much of
what a task needs survives a tight budget — it beat truncation but lost to plain keyword overlap on
those same six tasks (and even to a random order), the opposite of what the pre-holdout numbers
below showed. The Claude Code plugin's digest showed no demonstrated effect on them either, and it
now scores offline by default. Read [Does It Work?](#does-it-work) before deciding whether to opt
in; `ctxjev-mcp`, whose only job is exposing Jev, keeps calling it regardless of this default.

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
PreCompact             → score entries since the last compaction; cache the top few (~/.claude/ctxjev/)
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a digest; Claude Code adds it as a system reminder
```

Tool entries carry what was called (`Bash(npm test): 12 passed`, `Read(src/payments.ts): …`), so
both the scoring and the reminder know which command or file a result came from. Only what's still
in context counts: anything before the previous compaction is skipped.

The goal to score against is either set explicitly with `/ctxjev:set-goal <text>`, which applies
to the current session only and lasts through compactions, or inferred from your first request
plus your latest instruction. `/ctxjev:status` shows that goal and what the last run did,
including why if it skipped, failed, or fell back to offline scoring. The plugin's measured effect
so far is within the noise; see [Does It Work?](#does-it-work).

> **Privacy:** by default the plugin scores offline by keyword overlap and sends nothing anywhere.
> Only with `CTXJEV_SCORER=jev` (and `TYPESAFE_API_KEY`) does it send excerpts of your session to
> TypeSafe AI's Jev API, with common secret formats masked to `[REDACTED]` first (best-effort, not
> exhaustive). Its cache lives in `~/.claude/ctxjev/`, private to you, never in your project. See
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
your first request plus your latest instruction unless `--goal` overrides it. See
[`examples/sample-transcripts/claude-code-session.jsonl`](examples/sample-transcripts/claude-code-session.jsonl)
for a synthetic one. **Be careful pointing it at a real session log with `--scorer jev`**: entry
content is sent to the live Jev API, and although common secret formats are masked first, that
masking can't catch everything. The default scorer sends nothing.

## Does It Work?

The numbers below split into two groups. **Dev** (10 of the 15 sessions in
[`examples/eval-sessions`](examples/eval-sessions)) informed 0.5.0's design — `keepUserText`, the
removal note, and the plugin's goal inference were all built from failures seen on it, so read
those numbers as optimistic. **Holdout** (6 further tasks, recorded and labeled after that design
was frozen, [preregistered](packages/core/eval/PREREGISTRATION.md) before any of them were scored)
is what actually decided the default scorer, below.

### Holdout: does Jev's ranking beat plain truncation?

No, on task success; it depends, on what survives a tight budget. Six tasks (`rate-limit-window`,
`coupon-stacking`, `upload-size-limit`, `audit-retention`, `shipping-fee`, `room-booking`), each
with a mid-session constraint and one changed or added later, run through
[`eval/tasks.mjs`](packages/core/eval/tasks.mjs) and [`eval/run.mjs`](packages/core/eval/run.mjs)
exactly as preregistered:

| Task success (3 runs/task/model, budget 25%) | Claude Haiku 4.5 | Claude Sonnet 5 |
| --- | --- | --- |
| Everything | 100% | not run |
| **Pruned by Jev, as shipped** | **100%** | **100%** |
| Pruned by plain truncation, same options | 100% | 100% |
| Goal only | 0% | not run |

Jev minus truncation: **+0 points, 95% CI [+0, +0]**, on both models. Every task passed under every
history condition tested, on every run; only removing the history entirely (`goal-only`) failed.
That's the preregistered primary rule, and its answer is that Jev's ranking made no difference here.

| What survives a 25% budget (ranking alone, no `keepUserText`) | Share of needed facts retained |
| --- | --- |
| Hand labels (the best any ranking could do at this budget) | 32.7% |
| **Keyword overlap (`scorer: 'local'`, offline, free)** | **28.3%** |
| Random order (mean of 20 seeds) | 26.5% |
| Jev | 21.6% |
| Plain truncation | 0.0% |

From [`eval/results/run-holdout.json`](packages/core/eval/results/run-holdout.json)
(`eval/run.mjs --split holdout --runs 3 --json`). Keyword overlap, random, and truncation are
deterministic; Jev's answers vary between calls, and the three recorded runs on this material
(two in `PREREGISTRATION.md`, this one) put it between 18.5% and 21.6%.

The preregistered secondary rule compares Jev with truncation: the registered run gave +18.5
points, 95% CI [+7.1, +30.3] (this saved run: +21.6, [+5.7, +41.7]). That clears zero, so Jev
keeps more of what a task needs than truncation does on unseen sessions. But that's a low bar:
**on this material Jev retained less than keyword overlap and less than a random order.** On the
dev sessions Jev beat keyword overlap by a wide margin; on holdout it didn't. Neither comparison
decides the default scorer by the preregistered rule, but nothing here supports paying for Jev's
ranking over the free offline scorer.

**What this changes:** the default scorer for `ctxjev-core`, `ctxjev-cli`, and `pruneMessages()` is
now `'recency'` (plain truncation). Pass `scorer: 'jev'` / `--scorer jev` to opt in.
[`PREREGISTRATION.md`'s Results section](packages/core/eval/PREREGISTRATION.md) has the full
numbers and commands.

**Claude Code plugin.** The rerun (`eval/plugin.mjs --split holdout`, 6 tasks × 3 runs) found no
demonstrated effect: summary+digest passed 89% of tasks against summary alone's 100%, 95% CI for
the difference [-22, +0] — the lower bound doesn't clear zero, so the preregistered rule keeps the
plugin available without claiming it helps. See
[`PREREGISTRATION.md`'s Plugin (rerun) section](packages/core/eval/PREREGISTRATION.md) for the
full table. Given the retention numbers above, the plugin now scores offline by default and sends
nothing anywhere; Jev is opt-in (`CTXJEV_SCORER=jev`).

### Dev sessions (15 sessions, optimistic — see above)

- **Written sessions (5).** Written by hand, with raw tool output, dead ends, and distractors that
  share the goal's words.
- **Recorded sessions (10).** Real Claude Code sessions, recorded on the throwaway task repos in
  [`examples/eval-tasks`](examples/eval-tasks). Each task has a planted bug. The user states
  constraints partway through, and in two of them changes the plan. The session ends with the fix.

Intervals are 95% bootstrap intervals that resample whole sessions or tasks. With 10 tasks they're
wide, and they're shown so you can see how wide.

**1. Can an agent still finish the job?** [`eval/tasks.mjs`](packages/core/eval/tasks.mjs) cuts
each recorded session before "now implement the fix" and prunes the history to 25% of its tokens.
Claude Haiku 4.5 then does the fix with real tools in a fresh copy of the repo. It passes if the
hidden acceptance tests pass, and those tests include the constraints the user stated mid-session.
10 tasks × 2 runs:

| History given to the agent | Tasks passed | 95% CI |
| --- | --- | --- |
| Everything | 100% | [100, 100] |
| **Pruned to 25% by Jev, as shipped** (keeps user text, marks the gap) | **100%** | [100, 100] |
| **Newest kept, with the same two options** | **90%** | [70, 100] |
| Pruned by Jev ranking alone | 90% | [75, 100] |
| Newest kept (plain truncation) | 90% | [70, 100] |
| Pruned by keyword overlap | 75% | [55, 95] |
| Only the task | 40% | [15, 70] |

Against truncation with the same two options, the fair comparison, Jev is +10 points [0, +30]:
two runs out of twenty, both on one task (`webhook-dedupe`, which truncation failed twice). On the
other nine tasks the two passed every run.

The misses were agents that lost something the user said and filled the gap with their own guess.
One lost "keep the mark for 24 hours" and kept a later "maybe 25h for margin". Another lost the
exact masking format. That's why `pruneMessages()` now keeps what the user wrote and adds a
one-line note where it removed history. Both were designed from these failures, which is why these
tasks can't also be the test of them.

**With a stronger agent (Claude Sonnet 5), the difference goes away.** Same 10 tasks, 2 runs,
effort low: Jev as shipped passed 90%, and truncation with the same options passed 95% (−5 points
[−15, 0]). Both passed every run on nine of the ten tasks. The tenth is the "24 hours vs. maybe 25h"
task, where the recorded assistant's later suggestion contradicts the user: Jev lost it both times,
truncation once. So at a 25% budget on tasks this size, a strong agent recovers from pruning
whichever way it's done. What made the difference for Haiku was the weaker agent, not the ranking
alone.

**2. Can a model still answer from what's left?** [`eval/outcome.mjs`](packages/core/eval/outcome.mjs)
has Claude Haiku 4.5 answer each needed fact as a question from the pruned conversation, and Claude
Sonnet 5 grade it (102 questions, 2 runs):

| Context | 25% budget | 50% budget |
| --- | --- | --- |
| Everything | 95% | 95% |
| **Pruned by Jev** | **79%** | **91%** |
| Plain truncation | 71% | 83% |
| Keyword overlap | 67% | 74% |

Jev minus truncation is +8 points at both budgets, and the intervals just include zero
([−1, +18] and [−1, +19]). Jev minus keywords is +13 / +17, clearly above zero. Scoring alone
(ranking only, [`eval/results/run-dev.json`](packages/core/eval/results/run-dev.json)) keeps 86% /
96% of the facts under the budget, against 66% / 80% for truncation and 65% / 80% for keyword
overlap. Every release is gated on not
falling below truncation there (`eval/run.mjs --gate --runs 3`, which fails without a Jev key).

**3. Does the Claude Code plugin help after a compaction?**
[`eval/plugin.mjs`](packages/core/eval/plugin.mjs) runs the shipped hooks on each recorded
history. Claude Haiku 4.5 simulates the compaction summary; Claude Code's own compaction prompt
isn't public, so ours only approximates it, and it asks for every user instruction. The agent then
finishes the task from the summary, with or without the plugin's digest (10 tasks × 2 runs):

| After compaction | Tasks passed | Answers right |
| --- | --- | --- |
| Summary alone | 95% | 89% |
| Summary + digest (goal = latest message, as in 0.4.0) | 90% | 91% |
| Summary + digest (goal = first request + latest instruction, 0.5.0) | 100% | 90% |

**Honest reading:** against a summary that already keeps every user instruction, the digest adds
little. The 0.4.0 plugin aimed its scoring at the latest message ("also check the tests"), not the
task, and did no better than the summary alone. 0.5.0 infers the goal from the first request plus
the latest instruction. That passed every task, but +5 points [0, +15] is within the noise. The
plugin's value depends on how much the compaction summary drops, and this eval can't measure
Claude Code's real compaction.

**On unseen material, the rerun found no demonstrated effect.** The same comparison on the six
holdout tasks (3 runs each) put summary+digest at 89% tasks passed against summary alone's 100%,
95% CI for the difference [-22, +0] — the lower bound doesn't clear zero, so by the preregistered
rule this counts as no demonstrated effect, not as a negative result. Full table in
[`PREREGISTRATION.md`](packages/core/eval/PREREGISTRATION.md#plugin-rerun). The plugin stays
available.

What this doesn't show:

- The tasks are small, and 10 tasks × 2 runs (dev) or 6 tasks × 3 runs (holdout) are small samples.
- Most runs use Claude Haiku 4.5. Claude Sonnet 5 was checked on the task eval only, with 2 runs
  and two conditions.
- The recordings come from one recording model on tasks written for this eval.
- Token counts come from `gpt-tokenizer`, an approximation of Claude's tokenizer.

Every answer, verdict, digest, summary, and agent run is in
[`eval/results/`](packages/core/eval/results).

## Quick Start

```bash
npm install -g ctxjev-cli

ctxjev analyze transcript.jsonl --goal "Fix the checkout double-charge bug."
```

No key needed: the default scorer, `recency`, ranks by position alone and sends nothing. `--scorer
local` scores by keyword overlap instead, also offline. Want Jev's judgment? `export
TYPESAFE_API_KEY=...` (console.typesafe.ai/settings/keys, no waitlist) and add `--scorer jev` — see
[Does It Work?](#does-it-work) for what that currently buys you.

`ctxjev prune` writes a ctxjev-format or Anthropic Messages transcript back out with the drops
removed (to stdout, or `--out <file>`):

```bash
ctxjev prune examples/sample-transcripts/anthropic-messages.json --out pruned.json
```

Or from a clone, to run the exact sample transcript above:

```bash
git clone https://github.com/x96x64/ctxjev.git
cd ctxjev
pnpm install && pnpm build

node packages/cli/dist/index.js analyze examples/sample-transcripts/checkout-bug.json
```

## Packages

This is a pnpm workspace monorepo: one host-agnostic engine, and a thin adapter for each place
that engine gets used.

| Package | What it is | Status |
| --- | --- | --- |
| [`ctxjev-core`](packages/core) ([npm](https://www.npmjs.com/package/ctxjev-core)) | The engine: `scoreEntries()`/`pruneContext()`/`pruneMessages()`, plus the Claude Code transcript parser, secret masking, and the offline scorers. Everything else wraps this. | ✅ published |
| [`ctxjev-cli`](packages/cli) ([npm](https://www.npmjs.com/package/ctxjev-cli)) | `ctxjev analyze` (a report) and `ctxjev prune` (the transcript with drops removed). | ✅ published |
| [`ctxjev-mcp`](packages/mcp-server) ([npm](https://www.npmjs.com/package/ctxjev-mcp)) | MCP server exposing `score_relevance`/`prune_history` as tools. | ✅ published |
| [`ctxjev-claude`](packages/claude-plugin) | Claude Code plugin: scores at `PreCompact`, re-injects a digest at `SessionStart`, plus two inspection skills. | ✅ working (not on npm) |

## Using It from an MCP Host

**Read this first.** An MCP tool returns data to whoever called it; it can't remove anything from
the host's own context. And to score its history, the agent has to send that history *as tool
arguments*, which the host model pays for in its own output tokens. So in a host like Claude Code,
Codex, or Copilot, calling `prune_history` doesn't save tokens by itself. It's useful when
something acts on the scores: an agent framework that manages its own context and exposes tools,
or a workflow where knowing what's stale matters more than the cost of asking. For Claude Code
specifically, the [plugin](#the-claude-code-plugin) is the integration that actually helps.

`ctxjev-mcp` is a plain stdio server with two tools, `score_relevance` (scores per entry) and
`prune_history` (a keep/drop/summarize decision per entry, plus a savings report). Its whole job is
exposing Jev, so unlike the core default (`'recency'`, see [Does It Work?](#does-it-work)) it always
asks Jev and needs `TYPESAFE_API_KEY`. Setup for Claude Code, Codex (including this repo's
[Agent Plugins](https://agent-plugins.org) bundle), and GitHub Copilot, and an example response,
are in the [`ctxjev-mcp` README](packages/mcp-server/README.md).

## Design Notes

- **Claude Code's transcript format stays in one module.**
  [`claudeCodeTranscript.ts`](packages/core/src/claudeCodeTranscript.ts) parses Claude Code's
  undocumented session log, so a format change is a one-file fix. It returns only what's still in
  context (a compaction boundary resets the list), skips subagent sidechains (their result already
  appears as a tool call), and skips text Claude Code writes into the user turn itself: meta
  records, local command output, interrupt notices.
- **Every chunk sees the latest activity.** Entries are scored in chunks of 50, and each chunk's
  shared state also carries the batch's most recent entries, so an old failing test is judged
  knowing a later run fixed it. The score cache is keyed on that context too.
- **Secrets are masked before anything leaves the machine.** Every Jev request is built in
  [`buildJevRequest()`](packages/core/src/jevClient.ts), which runs goal and content through
  [`redactSecrets()`](packages/core/src/redact.ts) first. Best-effort, not a guarantee.
- **The scorer is pluggable, and the baselines ship.** `scorer` takes `'jev'`, `'recency'` (plain
  truncation), `'local'` (keyword overlap), or your own function, called per chunk with content
  already masked. The eval compares against the first two on every run.
- **Savings count what's actually removed, at its real size**: each entry's `sourceTokens`, the
  full payload, not the 600-character excerpt that gets scored. What `summarize` saves is reported
  separately, since it depends on your summarizer.
- **Pruning a conversation keeps it a valid request.**
  [`pruneMessages()`](packages/core/src/anthropicMessages.ts) removes a `tool_use` and its
  `tool_result` together, never touches the first message or the latest turn, and reports how much
  of a prompt cache the change invalidates. See
  [prompt caching](packages/core/README.md#with-prompt-caching).
- **Recency is relative to the batch**, oldest 0 to newest 1, not to `Date.now()`, so a transcript
  analyzed after the fact scores the same as a live one. `combinedScore` blends it in linearly at
  `recencyWeight` (default 0.1, from [a sweep](packages/core/eval/run.mjs) over labeled fixtures,
  one built so the root cause is early). `dropBelow` is 0.3, the highest value that lost no
  relevant entry on either fixture set.
- **Jev is never asked to count.** Token counts come from
  [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer), and costs from the usage Jev's
  API reports for each request (`onUsage`).

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
