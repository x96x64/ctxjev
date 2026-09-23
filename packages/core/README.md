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
Without one, pass `{ scorer: 'local' }` to score offline by keyword overlap instead: no network,
nothing sent, and much cruder than Jev.

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
- **`pruneMessages(messages, goal, options?)`** takes an Anthropic Messages conversation and returns
  `{ messages, decisions, removed }`: the conversation with dropped entries removed, still a valid
  request. A `tool_use` and its `tool_result` are removed together, a message left empty is
  removed, and the first message and the last `protectLast` messages (default 2) are never
  touched. `messagesToEntries(messages)` exposes the entry mapping on its own. Options:
  - `targetTokens`: after the drops, keep removing the lowest-scoring unprotected entries until
    the conversation fits. `overBudget` in the result says if only protected entries are left.
  - `summarize`: shorten entries marked `summarize` instead of leaving them as they are, either
    `'excerpt'` (the head and tail of the text) or your own `(entry, text) => Promise<string>`.
    A tool call keeps its `tool_use`; only its result is replaced.
  - `minSavedTokens`: change nothing unless it saves at least this many tokens.
  - `keepUserText` (default `true`): never remove what the user wrote. It costs few tokens and holds
    the constraints; in the task eval, an agent that lost "keep the mark for 24 hours" chose its own
    TTL.
  - `marker` (default `true`): add a one-line note where history was removed, so the model knows to
    re-read rather than trust what it half-remembers.

  The result reports `savedTokens`, `summarized`, and `cache` (see below).
- **`parseClaudeCodeTranscript(jsonl, { countTokens? })`** / **`inferGoalFromEntries(entries)`**
  parse a real Claude Code session `.jsonl` transcript into `Entry[]`, and infer a goal from the
  most recent user message. Pass `countTokens: estimateTokens` to fill in each entry's
  `sourceTokens`.
- **`summarizeSavings(entries, decisions)`** / **`estimateTokens(text)`** provide token-based
  savings reporting, using a real tokenizer and never asking Jev to count.
- `options.onUsage` (on `scoreEntries`/`pruneContext`) is an optional callback fired once per Jev
  request with that request's real `{ inputTokens, outputTokens }`, for cost tracking.
- `options.cache` takes any `{ get, set }` score cache, checked before each Jev request.
- `options.scorer: 'local'` scores offline with `localRelevance()` instead of Jev.
- `options.scorer` also takes your own function (`CustomScorer`), to score with another model or
  a rule set. It gets the goal, a chunk of up to 50 entries (content already masked by
  `redactSecrets()`), and the batch's latest activity, and returns one relevance from 0 to 1 per
  entry, in order. `cache` and `onUsage` apply to Jev only.

  ```ts
  const decisions = await pruneContext(entries, goal, undefined, {
    scorer: async (goal, chunk) => chunk.map((entry) => (entry.content.includes('[error]') ? 0.9 : myModel.score(goal, entry.content))),
  })
  ```
- **`redactSecrets(text)`** is the secret masking every Jev request already goes through.
- `summarizeSavings()` reports `droppedTokens` (saved once removed) separately from
  `summarizableTokens` (entries marked `summarize`). Jev doesn't generate text, so how much of the
  latter is saved depends on what you do with those entries: `pruneMessages`' `summarize` option
  can cut them to an excerpt or hand them to your own summarizer. Both counts use each entry's
  `sourceTokens` (the full payload's size) when it's set.

### With prompt caching

Removing anything from a conversation changes every request after it, so a prompt cache starts
over from the first changed message: that much has to be written to the cache again (at a
premium) instead of being read from it (at a discount). Pruning on every turn can easily cost more
than it saves. Prune in bulk instead, when the context crosses a threshold you choose, and check
the result's `cache.invalidatedTokens` against `savedTokens`:

```ts
if (contextTokens > 120_000) {
  const result = await pruneMessages(messages, goal, { targetTokens: 60_000, summarize: 'excerpt', minSavedTokens: 20_000 })
  messages = result.messages // result.cache: { firstChangedMessage, invalidatedTokens }
}
```

A large saving pays for one rewrite quickly, because every later turn reads the smaller
conversation from the cache again. `minSavedTokens` makes a small saving a no-op, so an unchanged
conversation keeps its cache.

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
