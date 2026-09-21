import { describe, expect, it } from 'vitest'
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
})
