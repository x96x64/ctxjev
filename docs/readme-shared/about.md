## About ctxjev

ctxjev scores an AI agent's history and decides what to keep, drop, or summarize. One engine comes
four ways:

| Package | What it is | Sends anything by default? |
| --- | --- | --- |
| [`ctxjev-core`](https://www.npmjs.com/package/ctxjev-core) | The library: `pruneMessages()`, `pruneContext()`, and the scorers | No |
| [`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli) | `ctxjev analyze` and `ctxjev prune` in a terminal | No |
| [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp) | `score_relevance` and `prune_history` as MCP tools, for Claude Code, Codex, and other hosts | No: only a call that passes `scorer: "jev"` |
| [Claude Code plugin](../claude-plugin/README.md) | Hands the highest-scoring entries back right after Claude Code compacts | No |

Scorers: `recency` (plain truncation: newest kept), `local` (keyword overlap with your goal), and
`jev` (TypeSafe AI's [Jev](https://typesafe.ai), opt-in, needs `TYPESAFE_API_KEY`). Full docs are in
the [ctxjev repository](../../README.md).
