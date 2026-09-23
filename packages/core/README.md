<div align="center">

# ctxjev-core

**Score AI agent context for relevance with Jev, the engine behind `ctxjev`.**

[![npm](https://img.shields.io/npm/v/ctxjev-core.svg)](https://www.npmjs.com/package/ctxjev-core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](package.json)

[Why](#why) · [Install](#install) · [How It Works](#how-it-works) · [API](#api) · [Related Packages](#related-packages)

</div>

---

## Why

Long-running agent loops, such as coding agents, browser agents, or anything with a growing
tool-call history, accumulate context faster than it stays useful. Most of that history isn't hard
to judge: *"is this old tool result still relevant to the current task?"* is exactly the kind of
fast, cheap, structured decision [Jev](https://typesafe.ai) (TypeSafe AI's typed-decision model) is
built for. It returns typed judgments (a yes/no probability, a choice, a score) in about 100ms
instead of writing a sentence about it.

`ctxjev-core` asks Jev that question continuously, and decides what to keep, drop, or summarize.
It never asks Jev to see images, do arithmetic, or generate text. Token counting happens in code,
and the keep/drop/summarize decision is a plain threshold applied to Jev's typed output.

## Install

```bash
npm install ctxjev-core
```

Requires `TYPESAFE_API_KEY` in the environment. Get one at
[console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys) (no waitlist).

Entry content and the goal are sent to TypeSafe AI's Jev API. Every request passes through
`redactSecrets()` first, masking common secret formats to `[REDACTED]` (best-effort, not
exhaustive). It's exported too, if you want to apply the same masking elsewhere.

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

```json
[
  { "entryId": "a", "relevance": 0.96, "recency": 0, "combinedScore": 0.864, "action": "keep" },
  { "entryId": "b", "relevance": 0.04, "recency": 1, "combinedScore": 0.136, "action": "drop" }
]
```

This is a real response shape, captured against the live API. `relevance` is Jev's own judgment,
`recency` is this entry's position in the batch (oldest=0, newest=1), and `combinedScore` blends
the two per `PruningPolicy.recencyWeight` before `action` is decided.

## API

- **`scoreEntries(entries, goal, recencyWeight?, options?)`** scores every entry with no decision
  made, and returns `{ entryId, relevance, recency, combinedScore }[]`.
- **`pruneContext(entries, goal, policy?, options?)`** runs `scoreEntries()` and applies
  `PruningPolicy`'s `dropBelow`/`summarizeBelow` thresholds, returning the same shape plus `action`.
- **`parseClaudeCodeTranscript(jsonl)`** / **`inferGoalFromEntries(entries)`** parse a real Claude
  Code session `.jsonl` transcript into `Entry[]`, and infer a goal from the most recent user
  message.
- **`summarizeSavings(entries, decisions)`** / **`estimateTokens(text)`** provide token-based
  savings reporting, using a real tokenizer and never asking Jev to count.
- `options.onUsage` (on `scoreEntries`/`pruneContext`) is an optional callback fired once per Jev
  request with that request's real `{ inputTokens, outputTokens }`, for cost tracking.

Full type definitions ship with the package. Design notes (why relevance and recency are separate
fields, why recency is batch-relative not wall-clock, how `recencyWeight`'s default was tuned
against labeled fixtures) live in the main repo's README.

## Related Packages

| Package | What it is |
| --- | --- |
| [`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli) | `ctxjev analyze <transcript>`: a plain-text report, no UI. |
| [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp) | MCP server exposing this engine as tools for Claude Code, Codex, and other MCP hosts. |
| `ctxjev-claude` | Claude Code plugin (not on npm; see the main repo). |

Full docs, design notes, and the Claude Code plugin live in the main repo:
**[github.com/x96x64/ctxjev](https://github.com/x96x64/ctxjev)**.

## License

This package is released under the [MIT](LICENSE) license: free to use, modify, and distribute,
including in a commercial product, as long as the license text and copyright notice ship with it.
See the [main repo](https://github.com/x96x64/ctxjev#license) for how this matches every
dependency `ctxjev` currently uses.
