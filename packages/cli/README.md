<div align="center">

# ctxjev-cli

**See what Jev would keep, drop, or summarize, right from your terminal.**

[![npm](https://img.shields.io/npm/v/ctxjev-cli.svg)](https://www.npmjs.com/package/ctxjev-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)

[Install](#install) · [Usage](#usage) · [Options](#options) · [Transcript Formats](#transcript-formats) · [Related Packages](#related-packages)

</div>

---

## Install

```bash
npm install -g ctxjev-cli
```

No key needed: the default, `--scorer recency` (newest kept, plain truncation), scores offline and
sends nothing, and tied Jev on a [preregistered holdout comparison](../core/eval/PREREGISTRATION.md)
(see the [main README](../../README.md#does-it-work)). `--scorer local` (keyword overlap) is also
offline. To opt in to Jev instead: `export TYPESAFE_API_KEY=...`
(console.typesafe.ai/settings/keys, no waitlist) and pass `--scorer jev`.

Versions before 0.6.0 (0.5.0 is the latest on npm as of 2026-09-24) score with Jev by default,
so they need the key unless you pass `--offline`, and have no `--scorer`.

With the default `recency`, the goal isn't used: an entry's score is its position (oldest 0,
newest 1), so the default thresholds drop roughly the oldest 30% of entries and mark the next 30%
for summarizing, whatever they say.

## Usage

`ctxjev analyze` reports what would be kept, dropped, or summarized. `ctxjev prune` writes a
ctxjev-format or Anthropic Messages transcript back out with the drops removed, to stdout or
`--out <file>`; for Anthropic Messages it keeps every `tool_use`/`tool_result` pair intact, and
never touches the first message, the latest turn (your last instruction and everything after it),
or the last `--protect-last` messages (default 2). A Claude Code
`.jsonl` can be analyzed but not pruned, since Claude Code doesn't load an edited transcript.

```bash
ctxjev analyze transcript.jsonl --goal "Fix the checkout double-charge bug."
```

Against the sample transcript in the ctxjev repo, the default ranks by position:

```console
$ ctxjev analyze checkout-bug.json

  e1  bash       drop       score 0.00  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       drop       score 0.17  read package.json — saw the dependency list and script names
  e3  grep       summarize  score 0.33  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       summarize  score 0.50  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.67  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.83  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       keep       score 1.00  ran: ls public/audio — unrelated, was checking something el…

3 kept, 2 summarized, 2 dropped (of 7 entries)
~27 / 154 tokens saved by dropping (18%), plus ~45 in entries marked summarize (savings there depend on your summarizer)
Scored by position alone (newest kept, like plain truncation) — no Jev call, nothing sent.
```

and with `--scorer jev`:

```console
$ ctxjev analyze checkout-bug.json --scorer jev

  e1  bash       summarize  score 0.52  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       drop       score 0.29  read package.json — saw the dependency list and script names
  e3  grep       keep       score 0.85  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       drop       score 0.14  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.89  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.90  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       drop       score 0.15  ran: ls public/audio — unrelated, was checking something el…

3 kept, 1 summarized, 3 dropped (of 7 entries)
~44 / 154 tokens saved by dropping (29%), plus ~16 in entries marked summarize (savings there depend on your summarizer)
Jev cost: 1,290 input tokens, 123 output tokens (free) — ~$0.000054
```

Both are real output, captured 2026-09-24. Jev is probabilistic, so its numbers vary slightly
between runs, and the cost line is computed from what Jev's API actually reported, not estimated.

## Options

| Flag | What it does |
| --- | --- |
| `--goal <text>` | Overrides the transcript's own goal (or the inferred one), if any. |
| `--drop-below <0-1>` | Relevance floor below which an entry is dropped (default `0.3`). |
| `--summarize-below <0-1>` | Relevance floor below which an entry is summarized (default `0.6`). |
| `--json` | Prints machine-readable JSON (`{ decisions, savings, usage, scorer }`) instead of the report. |
| `--no-cache` | Doesn't read or write the score cache (`~/.cache/ctxjev/score-cache.json`). |
| `--scorer <name>` | `recency` (default: position alone, plain truncation), `local` (keyword overlap), or `jev` (opt in; needs `TYPESAFE_API_KEY`). Only `jev` sends anything. |
| `--offline` | Same as `--scorer local`. |
| `--out <file>` | `prune`: writes the result here instead of to stdout. |
| `--protect-last <n>` | `prune`, Anthropic Messages only: never touches the last n messages (default 2). An error on any other format, which has no messages to protect. |
| `--no-protect-last-turn` | `prune`, Anthropic Messages only: lets the latest turn (the last user message with text, and every tool call after it) be pruned too. By default it never is; use this when the only instruction is the first message. |
| `--target-tokens <n>` | `prune`, Anthropic Messages only: after the drops, keeps removing the lowest-scoring entries until the conversation fits in n tokens. |
| `--summarize-excerpts` | `prune`, Anthropic Messages only: shortens entries marked summarize to the head and tail of their text, instead of leaving them as they are. |
| `--drop-user-text` | `prune`, Anthropic Messages only: lets what the user wrote be removed too. By default it's kept, because that's where constraints and changes of plan live. |
| `--no-marker` | `prune`, Anthropic Messages only: leaves out the one-line note that says where history was removed. |
| `--min-saved-tokens <n>` | `prune`, Anthropic Messages only: changes nothing unless it saves at least n tokens. The summary line shows where a prompt cache would start over. |
| `--help` / `--version` | Work without `TYPESAFE_API_KEY` set, before or after the command (`ctxjev prune --help`). |

## Transcript Formats

Auto-detected, no flag needed:

- **ctxjev's own format** is a single JSON document: `{ "goal": "...", "entries": [{ "id", "role", "toolName"?, "content", "timestamp" }] }`.
- **An Anthropic Messages conversation** is a `messages` array, bare or as `{ "goal"?, "messages" }`.
- **A Claude Code session** is a real `.jsonl` transcript (`transcript_path`, or anything under
  `~/.claude/projects`). The goal is inferred from your first request plus your latest instruction unless `--goal`
  overrides it.

> Never point this at a real, sensitive session log without checking its contents first. Entry
> content is sent to the live Jev API for scoring. Common secret formats are masked to
> `[REDACTED]` first, but that masking is best-effort and can't catch everything.

## Related Packages

| Package | What it is |
| --- | --- |
| [`ctxjev-core`](https://www.npmjs.com/package/ctxjev-core) | The engine this CLI wraps. |
| [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp) | The same scoring, as MCP tools for Claude Code, Codex, and other agent hosts. |

Full docs, design notes, and example transcripts live in the main repo:
**[github.com/x96x64/ctxjev](https://github.com/x96x64/ctxjev)**.

## License

This package is released under the [MIT](LICENSE) license: free to use, modify, and distribute,
including in a commercial product, as long as the license text and copyright notice ship with it.
See the [main repo](https://github.com/x96x64/ctxjev#license) for how this matches every
dependency `ctxjev` currently uses.
