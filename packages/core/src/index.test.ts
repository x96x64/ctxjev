import { describe, expect, it, vi } from 'vitest'
import { scoreEntries } from './index.js'
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
})
