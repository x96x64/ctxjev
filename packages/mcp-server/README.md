# ctxjev-mcp

MCP server exposing [Jev](https://typesafe.ai)-based context scoring/pruning (`score_relevance`,
`prune_history`) as tools for any MCP-capable agent host — Claude Code, Codex CLI, GitHub Copilot.

**Claude Code:**

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp
```

**Codex CLI:**

```bash
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp
```

Get a key at [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys) (no
waitlist). Full docs, design notes, and per-host setup live in the main repo:
**[github.com/x96x64/ctxjev](https://github.com/x96x64/ctxjev)**.

## License

MIT
