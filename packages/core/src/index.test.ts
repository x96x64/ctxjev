import { describe, expect, it, vi } from 'vitest'
import { scoreEntries, type CustomScorer } from './index.js'
import type { Entry } from './types.js'

describe('scoreEntries', () => {
  it('rejects entries that share an id before ever calling Jev', async () => {
    const entries: Entry[] = [
      { id: 'e1', role: 'user', content: 'first', timestamp: 1 },
      { id: 'e1', role: 'user', content: 'second, different content', timestamp: 2 },
    ]

    await expect(scoreEntries(entries, 'goal')).rejects.toThrow('duplicate entry id "e1"')
  })

  it("scores offline with scorer: 'local', without touching the cache or reporting usage", async () => {
    const entries: Entry[] = [
      { id: 'a', role: 'tool', content: 'chargeCustomer() is called again by the retry handler', timestamp: 1 },
      { id: 'b', role: 'tool', content: 'listed public/audio', timestamp: 2 },
    ]
    const cache = { get: vi.fn(), set: vi.fn() }
    const onUsage = vi.fn()

    const scored = await scoreEntries(entries, 'charge twice on retry', 0, { scorer: 'local', cache, onUsage })
    expect(scored[0].relevance).toBeGreaterThan(scored[1].relevance)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(onUsage).not.toHaveBeenCalled()
  })

  describe('with a custom scorer', () => {
    const many: Entry[] = Array.from({ length: 120 }, (_, i) => ({ id: `e${i}`, role: 'tool', content: `entry ${i}`, timestamp: i }))

    it('calls it once per chunk and keeps each score with its own entry', async () => {
      const scorer = vi.fn<CustomScorer>(async (_goal, entries) => entries.map((e) => Number(e.id.slice(1)) / 1000))
      const scored = await scoreEntries(many, 'goal', 0, { scorer })
      expect(scorer.mock.calls.map(([, chunk]) => chunk.length)).toEqual([50, 50, 20])
      expect(scored.map((s) => s.relevance)).toEqual(many.map((_, i) => i / 1000))
    })

    it('hands it redacted content and the batch-wide latest context, never the cache or usage hooks', async () => {
      const entries: Entry[] = [
        { id: 'a', role: 'tool', content: 'export TYPESAFE_API_KEY=abc123def456ghi', timestamp: 1 },
        { id: 'b', role: 'assistant', content: 'done', timestamp: 2 },
      ]
      const scorer = vi.fn<CustomScorer>(async (_goal, chunk) => chunk.map(() => 0.5))
      const cache = { get: vi.fn(), set: vi.fn() }
      const onUsage = vi.fn()
      await scoreEntries(entries, 'rotate key sk-ant-api03-abcdefghijklmnopqrstuv', 0, { scorer, cache, onUsage })

      const [goal, chunk, { latest }] = scorer.mock.calls[0]
      expect(goal).toBe('rotate key [REDACTED]')
      expect(chunk[0].content).toBe('export TYPESAFE_API_KEY=[REDACTED]')
      expect(latest.map((e) => e.id)).toEqual(['a', 'b'])
      expect(latest[0].content).toContain('[REDACTED]')
      expect(cache.get).not.toHaveBeenCalled()
      expect(onUsage).not.toHaveBeenCalled()
    })

    it('rejects a wrong number of scores, or one outside 0 to 1', async () => {
      const two: Entry[] = many.slice(0, 2)
      await expect(scoreEntries(two, 'goal', 0, { scorer: async () => [0.5] })).rejects.toThrow('1 scores for 2 entries')
      await expect(scoreEntries(two, 'goal', 0, { scorer: async () => [0.5, 1.5] })).rejects.toThrow('entry "e1"')
      await expect(scoreEntries(two, 'goal', 0, { scorer: async () => [Number.NaN, 0.5] })).rejects.toThrow('entry "e0"')
    })
  })
})
