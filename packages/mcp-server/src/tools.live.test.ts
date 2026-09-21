import type { Entry } from 'ctxjev-core'
import { describe, expect, it } from 'vitest'
import { pruneHistoryTool, scoreRelevanceTool } from './tools.js'

const entries: Entry[] = [
  { id: 'relevant', role: 'tool', toolName: 'grep', content: 'found chargeCustomer() called twice on retry', timestamp: 0 },
  { id: 'irrelevant', role: 'tool', toolName: 'ls', content: 'listed public/audio, unrelated', timestamp: 1 },
]

describe.skipIf(!process.env.TYPESAFE_API_KEY)('tools (live)', () => {
  it('scoreRelevanceTool returns a score per entry plus usage, no action', async () => {
    const result = await scoreRelevanceTool({ goal: 'fix the double-charge bug in checkout', entries })
    expect(result.scored).toHaveLength(2)
    expect(result.scored.every((s) => 'combinedScore' in s)).toBe(true)
    expect(result.scored.every((s) => !('action' in s))).toBe(true)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  }, 20_000)

  it('pruneHistoryTool returns decisions with actions plus a savings report and usage', async () => {
    const result = await pruneHistoryTool({ goal: 'fix the double-charge bug in checkout', entries })
    expect(result.decisions).toHaveLength(2)
    expect(result.decisions.every((d) => 'action' in d)).toBe(true)
    expect(result.savings.totalEntries).toBe(2)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  }, 20_000)
})
