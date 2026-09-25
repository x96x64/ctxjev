<div align="center">

# ctxjev-mcp

**Jev-based context scoring, as MCP tools for Claude Code, Codex, and any other MCP host.**

[![npm](https://img.shields.io/npm/v/ctxjev-mcp.svg)](https://www.npmjs.com/package/ctxjev-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)

[Setup](#setup) · [Tools](#tools) · [Example Response](#example-response) · [Related Packages](#related-packages)

</div>

---

`ctxjev-mcp` speaks plain stdio MCP: the same binary works with every host below, and only the
config shape differs.

> **Before you expect it to save tokens:** an MCP tool returns data to whoever called it; it can't
> remove anything from the host's own context. And to score its history, the agent has to send
> that history as tool arguments, which the host model pays for in its own output tokens. It's
> useful when something acts on the scores (an agent framework that manages its own context), not
> as a drop-in token saver for Claude Code, Codex, or Copilot. For Claude Code, the
> [ctxjev plugin](https://github.com/x96x64/ctxjev#the-claude-code-plugin) is the integration that
> actually helps.

## Setup

Every example below pins the version (`ctxjev-mcp@0.6.1`, the latest on npm), so your host runs the
release you chose rather than whatever npm has at the time; change the pin to upgrade.

Get a key at [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys) (no
waitlist) first. Without one the server still starts and lists its two tools, but every call
returns an error saying `TYPESAFE_API_KEY` isn't set.

**Claude Code:**

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.6.1
```

The ctxjev repo also carries a project-level `.mcp.json`, which runs the server from
`packages/mcp-server/dist/` and so needs `pnpm install && pnpm build` in the clone first. That scope
also needs an approval step
that didn't surface in the UI when tested (Claude Code v2.1.278): `claude mcp list` silently omits
the server. `claude mcp add` at local scope, as above, works immediately. If both exist, `claude
mcp list` warns that the server is defined in two scopes; that concerns OAuth token storage, which
a local stdio server doesn't use, so it's safe to ignore (or `claude mcp remove ctxjev -s project`).

**Codex CLI** (verified against `codex-cli` v0.155.1):

```bash
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.6.1
```

Or through the [Agent Plugins](https://agent-plugins.org) bundle in the ctxjev repo
(`.agents/plugins/marketplace.json`), which registers the same `npx ctxjev-mcp@0.6.1` command:

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

**GitHub Copilot** (VS Code, agent mode) uses `.vscode/mcp.json` (note the top-level key is
`servers`, not Claude Code's `mcpServers`):

```json
{
  "servers": {
    "ctxjev": {
      "type": "stdio",
      "command": "npx",
      "args": ["ctxjev-mcp@0.6.1"],
      "env": { "TYPESAFE_API_KEY": "..." }
    }
  }
}
```

## Tools

- **`score_relevance`** takes `{ goal, entries, recencyWeight? }` and returns a
  relevance/recency/combined score per entry plus Jev token usage, with no decision made.
- **`prune_history`** takes the same input plus `{ dropBelow?, summarizeBelow? }` and returns a
  decision (`keep`/`drop`/`summarize`) per entry, a savings report, and Jev token usage.

`entries` is `{ id, role: 'user'|'assistant'|'tool', toolName?, content, timestamp }[]`.

Entry content and the goal are sent to TypeSafe AI's Jev API. Common secret formats (API keys,
tokens, private-key blocks, `NAME=value` credentials) are masked to `[REDACTED]` first, on a
best-effort basis.

## Example Response

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

This is a real response body, captured against the live API.

## Related Packages

| Package | What it is |
| --- | --- |
| [`ctxjev-core`](https://www.npmjs.com/package/ctxjev-core) | The engine this server wraps. |
| [`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli) | The same scoring, as a terminal command. |

Full docs, design notes, and per-host setup live in the main repo:
**[github.com/x96x64/ctxjev](https://github.com/x96x64/ctxjev)**.

## License

This package is released under the [MIT](LICENSE) license: free to use, modify, and distribute,
including in a commercial product, as long as the license text and copyright notice ship with it.
See the [main repo](https://github.com/x96x64/ctxjev#license) for how this matches every
dependency `ctxjev` currently uses.
