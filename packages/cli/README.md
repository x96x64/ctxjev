# ctxjev-cli

**See what an AI agent's history could lose, and prune it, from your terminal: offline by default,
with Jev if you opt in.**

[![npm](https://img.shields.io/npm/v/ctxjev-cli.svg)](https://www.npmjs.com/package/ctxjev-cli)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-cli.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-cli.svg)](https://nodejs.org)

## Install

```bash
npm install -g ctxjev-cli
```

No key needed: the default, `--scorer recency` (newest kept, plain truncation), and `--scorer
local` (keyword overlap) both score offline and send nothing. To opt in to Jev, set
`TYPESAFE_API_KEY` (from [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys))
and pass `--scorer jev`.

With the default `recency`, the goal isn't used: an entry's score is its position (oldest 0,
newest 1), so the default thresholds drop roughly the oldest 30% of entries and mark the next 30%
for summarizing, whatever they say.

## Usage

`ctxjev analyze` reports each entry's verdict (keep, summarize, or drop) and what `ctxjev prune`
would actually remove with the same settings. `ctxjev prune` writes a
ctxjev-format or Anthropic Messages transcript back out with the drops removed, to stdout or
`--out <file>`, with every other field of the file as it was. In ctxjev's own format it never
removes the first user entry (usually the original request) or the last `--protect-last` entries
(default 2). For Anthropic Messages it keeps every `tool_use`/`tool_result` pair intact, and
never touches the first message, the latest turn (your last instruction and everything after it),
or the last `--protect-last` messages (default 2). A Claude Code
`.jsonl` can be analyzed but not pruned, since Claude Code doesn't load an edited transcript.

```bash
ctxjev analyze path/to/session.jsonl                       # a Claude Code session; the goal is inferred
ctxjev analyze checkout-bug.json --goal "Fix the checkout double-charge bug."
```

Against the sample transcript in the ctxjev repo
([`examples/sample-transcripts/checkout-bug.json`](https://github.com/x96x64/ctxjev/blob/main/examples/sample-transcripts/checkout-bug.json)),
the default ranks by position:

```console
$ ctxjev analyze checkout-bug.json
score: 0–1, position in the transcript (oldest 0, newest 1), not relevance: the goal isn't used · keep = leave as-is, summarize = worth shortening, drop = worth removing

  e1  bash       drop       score 0.00  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       drop       score 0.17  read package.json — saw the dependency list and script names
  e3  grep       summarize  score 0.33  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       summarize  score 0.50  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.67  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.83  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       keep       score 1.00  ran: ls public/audio — unrelated, was checking something el…

3 keep, 2 summarize, 2 drop (of 7 entries)
prune would remove the 2 entries marked drop, ~27 / 154 tokens (18%); the 2 entries marked summarize (~45 tokens) stay as they are unless you shorten them yourself
⚠ would remove the first entry (e1): this transcript has no user entry to protect as the original request
Scored by position alone (newest kept, like plain truncation) — no Jev call, nothing sent.
```

and with `--scorer jev`:

```console
$ ctxjev analyze checkout-bug.json --scorer jev
score: 0–1, Jev's judgment of relevance to your goal, blended with recency · keep = leave as-is, summarize = worth shortening, drop = worth removing

  e1  bash       summarize  score 0.51  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       drop       score 0.28  read package.json — saw the dependency list and script names
  e3  grep       keep       score 0.84  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       drop       score 0.14  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.88  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.90  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       drop       score 0.15  ran: ls public/audio — unrelated, was checking something el…

3 keep, 1 summarize, 3 drop (of 7 entries)
prune would remove 2 of the 3 entries marked drop, ~28 / 154 tokens (18%); the 1 entry marked summarize (~16 tokens) stays as it is unless you shorten it yourself
1 marked drop but kept: 1 protected in the last 2 entries
Jev cost: 1,290 input tokens, 123 output tokens (free) — ~$0.000054
```

Both are real output. Jev's answers vary slightly between runs, and its cost line is computed from
the usage Jev's API reported for that request, not estimated.

## Options

| Flag | What it does |
| --- | --- |
| `--goal <text>` | Overrides the transcript's own goal (or the inferred one), if any. |
| `--drop-below <0-1>` | Score below which an entry is marked drop (default `0.3`). |
| `--summarize-below <0-1>` | Score below which an entry is marked summarize (default `0.6`). |
| `--json` | `analyze`: prints machine-readable JSON (`{ decisions, savings, usage, scorer }`, plus `prune`, what `prune` would do, for ctxjev's own format and an Anthropic Messages transcript) instead of the report. `savings` counts the verdicts; `prune.savedTokens` is what `prune` would actually save. |
| `--no-cache` | Doesn't read or write the score cache (`~/.cache/ctxjev/score-cache.json`). |
| `--scorer <name>` | `recency` (default: position alone, plain truncation), `local` (keyword overlap), or `jev` (opt in; needs `TYPESAFE_API_KEY`). Only `jev` sends anything. |
| `--offline` | Same as `--scorer local`. |
| `--out <file>` | `prune`: writes the result here instead of to stdout. |
| `--protect-last <n>` | `analyze` and `prune`: never touches the last n messages of an Anthropic Messages transcript (at least 1), or the last n entries of ctxjev's own format (`0` turns it off). Default 2. An error on a Claude Code transcript, which `prune` can't write back. |
| `--no-protect-first` | ctxjev's own format only (`analyze` and `prune`): lets the first user entry, usually the original request, be removed too; `prune` warns when it is. By default it never is. |
| `--no-protect-last-turn` | Anthropic Messages only (`analyze` and `prune`): lets the latest turn (the last user message with text, and every tool call after it) be pruned too. By default it never is; use this when the only instruction is the first message. |
| `--target-tokens <n>` | Anthropic Messages only (`analyze` and `prune`): after the drops, keeps removing the lowest-scoring entries until the conversation fits in n tokens. |
| `--summarize-excerpts` | Anthropic Messages only (`analyze` and `prune`): shortens entries marked summarize to the head and tail of their text, instead of leaving them as they are. |
| `--drop-user-text` | Anthropic Messages only (`analyze` and `prune`): lets what the user wrote be removed too. By default it's kept, because that's where constraints and changes of plan live. |
| `--no-marker` | Anthropic Messages only (`analyze` and `prune`): leaves out the one-line note that says where history was removed. |
| `--min-saved-tokens <n>` | Anthropic Messages only (`analyze` and `prune`): changes nothing unless it saves at least n tokens. The summary line shows where a prompt cache would start over. |
| `--help` / `--version` | Work without `TYPESAFE_API_KEY` set, before or after the command (`ctxjev prune --help`). |

## Transcript formats

Auto-detected, no flag needed:

- **ctxjev's own format** is a single JSON document: `{ "goal": "...", "entries": [{ "id", "role", "toolName"?, "content", "timestamp" }] }`.
- **An Anthropic Messages conversation** is a `messages` array, bare or as `{ "goal"?, "messages" }`.
- **A Claude Code session** is a real `.jsonl` transcript (`transcript_path`, or anything under
  `~/.claude/projects`). The goal is inferred from your first request plus your latest instruction unless `--goal`
  overrides it.

> With the default `recency` scorer, and with `--scorer local`, nothing leaves your machine. With
> `--scorer jev`, entry content is sent to the live Jev API for scoring, so don't point that at a
> real, sensitive session log without checking its contents first: common secret formats are
> masked to `[REDACTED]` first, but that masking is best-effort and can't catch everything.

<!-- shared:about -->
## About ctxjev

ctxjev scores an AI agent's history and decides what to keep, drop, or summarize. One engine comes
four ways:

| Package | What it is | Sends anything by default? |
| --- | --- | --- |
| [`ctxjev-core`](https://www.npmjs.com/package/ctxjev-core) | The library: `pruneMessages()`, `pruneContext()`, and the scorers | No |
| [`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli) | `ctxjev analyze` and `ctxjev prune` in a terminal | No |
| [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp) | `score_relevance` and `prune_history` as MCP tools, for Claude Code, Codex, and other hosts | With a key set, masked excerpts to Jev unless a call picks `local` or `recency` |
| [Claude Code plugin](../claude-plugin/README.md) | Hands the highest-scoring entries back right after Claude Code compacts | No |

Scorers: `recency` (plain truncation: newest kept), `local` (keyword overlap with your goal), and
`jev` (TypeSafe AI's [Jev](https://typesafe.ai), opt-in, needs `TYPESAFE_API_KEY`). Full docs are in
the [ctxjev repository](../../README.md).
<!-- /shared:about -->

<!-- shared:privacy -->
## Privacy

- With `recency` or `local`, nothing is sent anywhere.
- With `jev`, the goal and a short excerpt of each entry are sent to TypeSafe AI's Jev API, after
  common secret formats are replaced with `[REDACTED]` and without entry ids. The masking is
  pattern matching: it narrows exposure but can't recognize every secret.
- Without a usable `TYPESAFE_API_KEY` (unset, blank, or an unexpanded placeholder such as
  `${TYPESAFE_API_KEY}`), nothing is sent, and whatever asked for Jev says so.

How well the masking works is measured in the [evaluation](../../docs/evaluation.md#secret-masking-measured-blind).
To report a leak, see the [security policy](../../SECURITY.md).
<!-- /shared:privacy -->

<!-- shared:status -->
## Status and limits

<!-- checked-prose -->
Whether pruning this way helps an agent finish its work hasn't been shown. In a preregistered
comparison on <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> tasks the design had never seen, Jev's ranking and plain truncation
gave the same task success (difference in percentage points, with its 95% CI:
<!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku --> with Claude Haiku 4.5, <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet --> with Claude Sonnet 5), and the Claude
Code plugin's digest had no demonstrated effect. The [evaluation](../../docs/evaluation.md) has
every number and what it can't show.
<!-- /checked-prose -->
<!-- /shared:status -->

<!-- shared:license -->
## License

[MIT](LICENSE). ctxjev is an independent project, not affiliated with or endorsed by TypeSafe AI
or Anthropic.
<!-- /shared:license -->
