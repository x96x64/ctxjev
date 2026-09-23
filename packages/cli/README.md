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
export TYPESAFE_API_KEY=...   # console.typesafe.ai/settings/keys (no waitlist)
```

No key yet? `--offline` scores by keyword overlap instead, with nothing sent anywhere.

## Usage

`ctxjev analyze` is analysis only: it reports what would be kept, dropped, or summarized, and
never modifies the transcript.

```bash
ctxjev analyze transcript.jsonl --goal "Fix the checkout double-charge bug."
```

```console
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

This is real output against a sample transcript. Jev is probabilistic, so exact numbers vary
slightly between runs, and the cost line is computed from what Jev's API actually reported, not
estimated.

## Options

| Flag | What it does |
| --- | --- |
| `--goal <text>` | Overrides the transcript's own goal (or the inferred one), if any. |
| `--drop-below <0-1>` | Relevance floor below which an entry is dropped (default `0.25`). |
| `--summarize-below <0-1>` | Relevance floor below which an entry is summarized (default `0.6`). |
| `--json` | Prints machine-readable JSON (`{ decisions, savings, usage, scorer }`) instead of the report. |
| `--no-cache` | Doesn't read or write the score cache (`~/.cache/ctxjev/score-cache.json`). |
| `--offline` | Scores by keyword overlap instead of Jev: no API key needed, nothing sent. Much cruder, so treat the decisions as a rough guide. |
| `--help` / `--version` | Work without `TYPESAFE_API_KEY` set. |

## Transcript Formats

Auto-detected, no flag needed:

- **ctxjev's own format** is a single JSON document: `{ "goal": "...", "entries": [{ "id", "role", "toolName"?, "content", "timestamp" }] }`.
- **A Claude Code session** is a real `.jsonl` transcript (`transcript_path`, or anything under
  `~/.claude/projects`). The goal is inferred from your most recent chat message unless `--goal`
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
