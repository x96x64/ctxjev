# ctxjev-core

**Decide what to keep, drop, or summarize in an AI agent's history: by recency (the default),
keyword overlap, or Jev's judgment of relevance (opt-in).** The engine behind
[`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli), [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp),
and the ctxjev Claude Code plugin.

[![npm](https://img.shields.io/npm/v/ctxjev-core.svg)](https://www.npmjs.com/package/ctxjev-core)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-core.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-core.svg)](https://nodejs.org)

## Install

```bash
npm install ctxjev-core
```

No key and no network are needed by default: the default scorer, `'recency'`, ranks by position
alone (newest kept, the same as plain truncation) and sends nothing. `{ scorer: 'local' }` scores
by keyword overlap, also offline. `{ scorer: 'jev' }` opts in to Jev and needs `TYPESAFE_API_KEY`
(get one at [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys)).

## Usage

In an agent loop that sends Anthropic Messages, prune the conversation before the next request:

```ts
import { pruneMessages } from 'ctxjev-core'

const { messages: pruned, removed, savedTokens } = await pruneMessages(
  messages,
  'Fix a bug where checkout charges customers twice on a slow network retry.',
  { scorer: 'local' }, // or 'jev' to opt in; the default is 'recency'
)
```

For any other history shape, map it to plain entries and ask for a decision per entry:

```ts
import { pruneContext } from 'ctxjev-core'

const decisions = await pruneContext(
  entries, // { id, role: 'user' | 'assistant' | 'tool', toolName?, content, timestamp }[]
  'Fix a bug where checkout charges customers twice on a slow network retry.',
  undefined, // the default policy
  { scorer: 'jev' },
)
```

```json
[
  { "entryId": "a", "relevance": 0.96, "recency": 0, "combinedScore": 0.864, "action": "keep" },
  { "entryId": "b", "relevance": 0.04, "recency": 1, "combinedScore": 0.136, "action": "drop" }
]
```

That's the shape of a real response from Jev (its values vary between runs). `relevance` is the
scorer's judgment, `recency` is the entry's position in the batch (oldest 0, newest 1), and
`combinedScore` blends the two by `PruningPolicy.recencyWeight` before `action` is decided.

## Scorers

- **`'recency'` (default):** the goal isn't used. Every entry's relevance is its position, so with
  the default thresholds (`dropBelow` 0.3, `summarizeBelow` 0.6) `pruneContext()` drops roughly the
  oldest 30% of entries and marks the next 30% for summarizing, whatever they say, including
  the first request. `pruneMessages()` never touches the first message, the latest turn, or (by
  default) anything the user wrote; `pruneEntries(entries, decisions)` applies decisions to a plain
  entry list and keeps the first user entry and the last two entries.
- **`'local'`:** keyword overlap with the goal, ranked within the batch before the thresholds
  apply, so a decision's `relevance` is the entry's percentile rank (tied entries share their
  average rank). When most entries share no word with the goal, they tie in the middle and are
  marked `summarize`, not dropped; pass `targetTokens` to `pruneMessages()` for a fixed size. When
  every entry ties, there's nothing to rank: each keeps its raw overlap as `relevance`, marked
  `tied: true`, and position alone decides.
- **`'jev'`:** each entry becomes a yes/no question to Jev, and up to 50 are asked in one request
  against a shared state. The goal and each entry's excerpt are sent to TypeSafe AI's Jev API after
  `redactSecrets()` masks common secret formats (best-effort, not exhaustive). Every request's
  real token usage is reported through `onUsage`.
- **Your own function** (`CustomScorer`), described under `options.scorer` below.


## API

- **`scoreEntries(entries, goal, recencyWeight?, options?)`** scores every entry with no decision
  made, and returns `{ entryId, relevance, recency, combinedScore }[]`.
- **`pruneContext(entries, goal, policy?, options?)`** runs `scoreEntries()` and applies
  `PruningPolicy`'s `dropBelow`/`summarizeBelow` thresholds, returning the same shape plus `action`.
- **`pruneMessages(messages, goal, options?)`** takes an Anthropic Messages conversation and returns
  `{ messages, decisions, removed }`: the conversation with dropped entries removed, still a valid
  request. A `tool_use` and its `tool_result` are removed together, a message left empty is
  removed, and the first message and the latest turn are never touched.
  `messagesToEntries(messages)` exposes the entry mapping on its own. Options:
  - `protectLastTurn` (default `true`): the latest turn is the last user message with text of its
    own (an instruction, not only tool results) and everything after it, however many tool
    round-trips that is. **In an agent loop whose only user text is the first message, that's the
    whole conversation, so nothing is pruned**: pass `protectLastTurn: false` there.
  - `protectLast` (default 2): the last this-many messages are never touched either way, a floor
    for tool calls still waiting on a result.
  - `targetTokens`: after the drops, keep removing the lowest-scoring unprotected entries until
    the conversation fits. `overBudget` in the result says if only protected entries are left.
  - `summarize`: shorten entries marked `summarize` instead of leaving them as they are, either
    `'excerpt'` (the head and tail of the text) or your own `(entry, text) => Promise<string>`.
    A tool call keeps its `tool_use`; only its result is replaced.
  - `minSavedTokens`: change nothing unless it saves at least this many tokens.
  - `keepUserText` (default `true`): never remove what the user wrote. It costs few tokens and holds
    the constraints and changes of plan.
  - `marker` (default `true`): add a one-line note where history was removed, so the model knows to
    re-read rather than trust what it half-remembers.

  The result reports `savedTokens`, `summarized`, and `cache` (see below), and `keptDrops`: the
  entries marked `drop` that weren't removed, by reason. `firstMessage`, `latestTurn`,
  `lastMessages`, and `userText` are protected; `noNetSaving` (removing them wouldn't save any tokens
  once the removal note is counted) and `belowMinSaved` (held back by `minSavedTokens`) are not.
  `noteOmitted` is `true` when entries were removed but the note had nowhere to go: it goes into
  the first unprotected user message after the first change, and there wasn't one (common with
  `keepUserText: false` and a tight `targetTokens`). A message holding only the note isn't inserted
  instead: between a `tool_use` and its `tool_result` it would make the request invalid.
- **`typesafeApiKey(env?)`** / **`missingTypesafeApiKey(env?)`** return the usable Jev key in
  `TYPESAFE_API_KEY` (or `undefined`), and why there isn't one. A value that's only an unexpanded
  placeholder (`${TYPESAFE_API_KEY}`, `$NAME`, `%NAME%`) is no key, and Jev is never called without one.
- **`parseClaudeCodeTranscript(jsonl, { countTokens? })`** / **`resolveClaudeCodeGoal(jsonl, entries)`**
  parse a real Claude Code session `.jsonl` transcript into `Entry[]` (what's still in context,
  without the text Claude Code writes into the user turn itself), and find the goal: the latest
  `/ctxjev:set-goal`, or else the session's first request plus its latest instruction. Pass
  `countTokens: estimateTokens` to fill in each entry's `sourceTokens`.
- **`summarizeSavings(entries, decisions)`** / **`estimateTokens(text)`** provide token-based
  savings reporting, using a real tokenizer and never asking Jev to count.
- `options.onUsage` (on `scoreEntries`/`pruneContext`) is an optional callback fired once per Jev
  request with that request's real `{ inputTokens, outputTokens }`, for cost tracking.
- `options.cache` takes any `{ get, set }` score cache, checked before each Jev request.
- `options.scorer: 'recency'` (default) ranks by position alone (plain truncation); `'local'`
  scores by keyword overlap with `localRelevance()`. Both are offline. `'jev'` opts in to Jev.
- `options.scorer` also takes your own function (`CustomScorer`), to score with another model or
  a rule set. It gets the goal, a chunk of up to 50 entries (content already masked by
  `redactSecrets()`), and the batch's latest activity, and returns one relevance from 0 to 1 per
  entry, in order. `cache` and `onUsage` apply to Jev only.

  ```ts
  const decisions = await pruneContext(entries, goal, undefined, {
    scorer: async (goal, chunk) => chunk.map((entry) => (entry.content.includes('[error]') ? 0.9 : myModel.score(goal, entry.content))),
  })
  ```
- **`redactSecrets(text)`** is the secret masking every Jev request already goes through. What it
  leaves alone on purpose: a value that reads as a variable reference (`$NAME`, `${NAME}`,
  `%NAME%`, and `%NAME` without the closing `%`) is taken for a placeholder, so a real password of
  that shape (`DB_PASSWORD=$Qx7vR2mKpL9zW4tB`: a `$` or `%` and then only letters and digits) is
  kept as written. A command's password argument (`mysql -p…`, `curl -u user:…`) is kept only as
  `$NAME`, `${NAME}`, or `%NAME%`, and not in single quotes, where the shell doesn't expand it.
  Prose after a label (`Token: expired yesterday`, `トークン：有効期限切れ`) is kept.
  A URL whose password is followed by a path that itself holds `@host` loses that part of the path
  too: the password is read up to the last `@` a host follows, so more is hidden rather than less.
- `summarizeSavings()` counts the verdicts: `droppedTokens` (in entries marked `drop`: saved once
  they're all removed, which is what ctxjev-format pruning does; for an Anthropic Messages
  conversation, `pruneMessages()`' `savedTokens` is what's actually saved) separately from
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

Full type definitions ship with the package. Why relevance and recency are separate fields, why
recency is relative to the batch rather than the clock, and how `recencyWeight`'s default was
chosen are in the [design notes](../../docs/design-notes.md).

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
