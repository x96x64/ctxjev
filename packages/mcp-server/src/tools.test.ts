import { describe, expect, it } from 'vitest'
import type { Entry, JevClient } from 'ctxjev-core'
import { createBoundedScoreCache, pruneHistoryTool, scoreRelevanceTool } from './tools.js'

describe('createBoundedScoreCache', () => {
  it('evicts the least recently used key past its limit', () => {
    const cache = createBoundedScoreCache(2)
    cache.set('a', 0.1)
    cache.set('b', 0.2)
    expect(cache.get('a')).toBe(0.1) // a is now the most recently used
    cache.set('c', 0.3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(0.1)
    expect(cache.get('c')).toBe(0.3)
    expect(cache.size).toBe(2)
  })
})

// The success path (tools.ts's two tools) only ever ran in the live tests, which need a key (the
// third audit, 4.5-2 and improvement 9). A stand-in for Jev's client runs it offline: it answers
// every question by the entry's content and records each request.
function fakeJev(relevanceFor: (content: string) => number = () => 0.5) {
  const requests: Array<{ state: { goal: string; entries: Record<string, { content: string }> }; questions: Record<string, unknown> }> = []
  const client = {
    async systemOne(request: unknown) {
      const { state, questions } = request as (typeof requests)[number]
      requests.push({ state, questions })
      const answers = Object.fromEntries(Object.keys(questions).map((id) => [id, { noul: relevanceFor(state.entries[id].content) }]))
      return { answers, usage: { input_tokens: 100 * Object.keys(questions).length, output_tokens: Object.keys(questions).length } }
    },
  } as unknown as JevClient
  return { client, requests }
}

const entries: Entry[] = [
  { id: 'a', role: 'tool', toolName: 'grep', content: 'found chargeCustomer() called twice on retry', timestamp: 0 },
  { id: 'b', role: 'tool', toolName: 'ls', content: 'listed public/audio', timestamp: 1 },
  { id: 'c', role: 'assistant', content: 'the retry handler charges again', timestamp: 2 },
]
const byContent = (content: string) => (content.includes('charge') ? 0.9 : 0.05)

describe('scoreRelevanceTool, with a stand-in for Jev', () => {
  it('scores every entry through Jev, blending recency, and reports the usage Jev returned', async () => {
    const jev = fakeJev(byContent)
    const { scored, usage } = await scoreRelevanceTool({ goal: 'fix the double charge', entries }, { jevClient: jev.client, cache: createBoundedScoreCache() })
    expect(scored.map((s) => s.entryId)).toEqual(['a', 'b', 'c'])
    expect(scored.map((s) => s.relevance)).toEqual([0.9, 0.05, 0.9])
    expect(scored.map((s) => s.recency)).toEqual([0, 0.5, 1])
    expect(scored[0].combinedScore).toBeCloseTo(0.9 * 0.9 + 0 * 0.1, 10)
    expect(usage).toEqual({ inputTokens: 300, outputTokens: 3 })
    expect(jev.requests).toHaveLength(1)
    expect(jev.requests[0].state.goal).toBe('fix the double charge')
  })

  it('uses recencyWeight when given', async () => {
    const { scored } = await scoreRelevanceTool({ goal: 'g', entries, recencyWeight: 1 }, { jevClient: fakeJev().client, cache: createBoundedScoreCache() })
    expect(scored.map((s) => s.combinedScore)).toEqual([0, 0.5, 1])
  })

  it('reuses cached scores: the same call again sends nothing and reports no usage', async () => {
    const jev = fakeJev(byContent)
    const cache = createBoundedScoreCache()
    await scoreRelevanceTool({ goal: 'g', entries }, { jevClient: jev.client, cache })
    const again = await scoreRelevanceTool({ goal: 'g', entries }, { jevClient: jev.client, cache })
    expect(jev.requests).toHaveLength(1)
    expect(again.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(again.scored.map((s) => s.relevance)).toEqual([0.9, 0.05, 0.9])
  })

  it('masks secrets and never sends entry ids', async () => {
    const jev = fakeJev()
    await scoreRelevanceTool({ goal: 'rotate it; DB_PASSWORD=hunter22', entries: [{ id: 'toolu_secret_id', role: 'tool', content: 'Error: DB_PASSWORD=hunter22', timestamp: 0 }] }, { jevClient: jev.client, cache: createBoundedScoreCache() })
    const sent = JSON.stringify(jev.requests)
    expect(sent).not.toContain('hunter22')
    expect(sent).not.toContain('toolu_secret_id')
  })
})

describe('pruneHistoryTool, with a stand-in for Jev', () => {
  it('decides keep, summarize, or drop per the policy, and counts the savings', async () => {
    const withTokens = entries.map((e) => ({ ...e, sourceTokens: 100 }))
    const { decisions, savings, usage } = await pruneHistoryTool({ goal: 'fix the double charge', entries: withTokens }, { jevClient: fakeJev(byContent).client, cache: createBoundedScoreCache() })
    expect(decisions.map((d) => d.action)).toEqual(['keep', 'drop', 'keep'])
    expect(savings).toMatchObject({ totalEntries: 3, keptEntries: 2, droppedEntries: 1, totalTokens: 300, droppedTokens: 100 })
    expect(usage.inputTokens).toBe(300)
  })

  it('applies dropBelow, summarizeBelow, and recencyWeight when given', async () => {
    const { decisions } = await pruneHistoryTool({ goal: 'g', entries, dropBelow: 0, summarizeBelow: 1, recencyWeight: 0 }, { jevClient: fakeJev(byContent).client, cache: createBoundedScoreCache() })
    expect(decisions.map((d) => d.action)).toEqual(['summarize', 'summarize', 'summarize'])
  })

  it('refuses a reversed pair of thresholds before calling Jev', async () => {
    const jev = fakeJev()
    await expect(pruneHistoryTool({ goal: 'g', entries, dropBelow: 0.7, summarizeBelow: 0.2 }, { jevClient: jev.client, cache: createBoundedScoreCache() })).rejects.toThrow(/dropBelow \(0.7\) must not be greater than summarizeBelow \(0.2\)/)
    expect(jev.requests).toHaveLength(0)
  })
})
