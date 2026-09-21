import type { Entry } from 'ctxjev-core'
import { describe, expect, it } from 'vitest'
import { pruneHistoryTool, scoreRelevanceTool } from './tools.js'

// tools.ts wires both tools into one shared, module-level score cache (keyed by goal + entry
// content, matching ctxjev-cli's own file-backed cache) — so each test below uses its own goal
// to guarantee a real cache miss and a real Jev call, rather than silently hitting whatever the
// other test already cached for the same (goal, entry) pair.
const entries: Entry[] = [
  { id: 'relevant', role: 'tool', toolName: 'grep', content: 'found chargeCustomer() called twice on retry', timestamp: 0 },
  { id: 'irrelevant', role: 'tool', toolName: 'ls', content: 'listed public/audio, unrelated', timestamp: 1 },
]

describe.skipIf(!process.env.TYPESAFE_API_KEY)('tools (live)', () => {
  it('scoreRelevanceTool returns a score per entry plus usage, no action', async () => {
    const result = await scoreRelevanceTool({ goal: 'fix the double-charge bug in checkout (score)', entries })
    expect(result.scored).toHaveLength(2)
    expect(result.scored.every((s) => 'combinedScore' in s)).toBe(true)
    expect(result.scored.every((s) => !('action' in s))).toBe(true)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  }, 20_000)

  it('pruneHistoryTool returns decisions with actions plus a savings report and usage', async () => {
    const result = await pruneHistoryTool({ goal: 'fix the double-charge bug in checkout (prune)', entries })
    expect(result.decisions).toHaveLength(2)
    expect(result.decisions.every((d) => 'action' in d)).toBe(true)
    expect(result.savings.totalEntries).toBe(2)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  }, 20_000)

  it('a repeated call with the same goal and entries hits the cache and spends no more tokens', async () => {
    const goal = 'fix the double-charge bug in checkout (cache check)'
    await scoreRelevanceTool({ goal, entries })
    const second = await scoreRelevanceTool({ goal, entries })
    expect(second.usage.inputTokens).toBe(0)
  }, 20_000)
})
