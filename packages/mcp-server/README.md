# ctxjev-mcp

**Context scoring as MCP tools for Claude Code, Codex, and any other MCP host: with Jev by default,
or offline.**

[![npm](https://img.shields.io/npm/v/ctxjev-mcp.svg)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-mcp.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-mcp.svg)](https://nodejs.org)

`ctxjev-mcp` is a stdio MCP server with two tools, `score_relevance` and `prune_history`. The same
command works with every host below; only the config shape differs.

> **Before you expect it to save tokens:** an MCP tool returns data to whoever called it; it can't
> remove anything from the host's own context. And to score its history, the agent has to send
> that history as tool arguments, which the host model pays for in its own output tokens. It's
> useful when something acts on the scores (an agent framework that manages its own context), not
> as a drop-in token saver. For Claude Code, the
> [ctxjev plugin](https://github.com/x96x64/ctxjev/tree/main/packages/claude-plugin) is the
> integration that works alongside compaction.

## What it sends

Both tools score with Jev unless a call passes `scorer: "local"` (keyword overlap with the goal)
or `scorer: "recency"` (newest first, the same as plain truncation). With Jev, the goal and an
excerpt of each entry are sent to TypeSafe AI's Jev API, after common secret formats are masked to
`[REDACTED]` (best-effort, not exhaustive). `local` and `recency` run offline and send nothing.

Jev needs a key from [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys)
in the server's environment. Without one the server still starts and lists its tools, `local` and
`recency` work, and a call that would use Jev returns an error saying the key is missing, having
sent nothing. A value that is only an unexpanded placeholder, such as `${TYPESAFE_API_KEY}`, counts
as no key.

## Setup

Every example pins the version (`ctxjev-mcp@0.7.2`), so your host runs the release you chose
rather than whatever npm has at the time; change the pin to upgrade. For offline use only, leave
out `--env TYPESAFE_API_KEY=...` (or the `env` block).

**Claude Code:**

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2
```

**Codex:**

```bash
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2
```

Or install the plugin bundle in the ctxjev repository, which registers the same command and tells
Codex to pass `TYPESAFE_API_KEY` through from the environment it runs in (`env_vars`):

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

**GitHub Copilot** (VS Code, agent mode) uses `.vscode/mcp.json`, whose top-level key is `servers`,
not `mcpServers`:

```json
{
  "servers": {
    "ctxjev": {
      "type": "stdio",
      "command": "npx",
      "args": ["ctxjev-mcp@0.7.2"],
      "env": { "TYPESAFE_API_KEY": "..." }
    }
  }
}
```

## Tools

- **`score_relevance`** takes `{ goal, entries, scorer?, recencyWeight? }` and returns a
  relevance/recency/combined score per entry plus Jev token usage, with no decision made.
  `scorer` is `"jev"` (the default; needs `TYPESAFE_API_KEY`), `"local"`, or
  `"recency"`; the last two run offline and report zero usage. Under `"local"`, relevance is the
  keyword overlap ranked within the batch, the same scale `prune_history`'s thresholds use; when every entry overlaps equally, it's the overlap itself, marked
  `tied`.
- **`prune_history`** takes the same input plus `{ dropBelow?, summarizeBelow? }` and returns a
  decision (`keep`/`drop`/`summarize`) per entry, a savings report, and Jev token usage.

`entries` is `{ id, role: 'user'|'assistant'|'tool', toolName?, content, timestamp }[]`. An
argument a tool doesn't take (a misspelt `recencyweight`, a `policy` object) is an error rather than
ignored.

With `scorer: "jev"`, entry content and the goal are sent to TypeSafe AI's Jev API (with `"local"`
or `"recency"`, nothing is sent anywhere). Common secret formats (API keys,
tokens, private-key blocks, `NAME=value` credentials) are masked to `[REDACTED]` first, on a
best-effort basis.

## Example response

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

This is a real response body from the live API; Jev's values vary between runs.

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
