import type { JevUsage } from './types.js'

/**
 * Accumulates `JevUsage` across multiple `onUsage` calls — one per chunked Jev request within a
 * single `scoreEntries`/`pruneContext` call. Both `ctxjev-cli` and `ctxjev-mcp` needed this exact
 * accumulation, so it lives here instead of being duplicated in each adapter.
 */
export function createUsageAccumulator(): { usage: JevUsage; onUsage: (u: JevUsage) => void } {
  const usage: JevUsage = { inputTokens: 0, outputTokens: 0 }
  return {
    usage,
    onUsage: (u) => {
      usage.inputTokens += u.inputTokens
      usage.outputTokens += u.outputTokens
    },
  }
}
