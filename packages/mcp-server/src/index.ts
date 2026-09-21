/**
 * MCP server exposing ctxjev-core over the Model Context Protocol, so any MCP-capable agent
 * host (Claude Code, and — pending confirmation of their current MCP support — Codex CLI,
 * GitHub Copilot) can call it without a dedicated adapter.
 *
 * Planned tools:
 *   - score_relevance(goal, entries[])            -> PruneDecision[] (no history mutation)
 *   - prune_history(goal, entries[], policy?)      -> { kept, dropped, summarized, savingsReport }
 *
 * TODO(phase 2): implement against @modelcontextprotocol/sdk's server + stdio transport.
 * Verify end-to-end against Claude Code itself (a local .mcp.json entry) before assuming
 * any other host works the same way.
 */
export {}
