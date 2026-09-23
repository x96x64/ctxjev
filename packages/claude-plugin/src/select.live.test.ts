import type { Entry } from 'ctxjev-core'
import { describe, expect, it } from 'vitest'
import { selectPreserved } from './select.js'

const entries: Entry[] = [
  { id: 'relevant', role: 'tool', toolName: 'grep', content: 'found chargeCustomer() called twice on retry', timestamp: 0 },
  { id: 'irrelevant', role: 'tool', toolName: 'ls', content: 'listed public/audio, unrelated', timestamp: 1 },
]

describe.skipIf(!process.env.TYPESAFE_API_KEY)('selectPreserved (live)', () => {
  it('ranks the relevant entry above the irrelevant one and carries its content', async () => {
    const selected = await selectPreserved(entries, 'fix the double-charge bug in checkout', 5)
    expect(selected[0].entryId).toBe('relevant')
    expect(selected[0].content).toBe('found chargeCustomer() called twice on retry')
  }, 20_000)

  it('respects the limit', async () => {
    const selected = await selectPreserved(entries, 'fix the double-charge bug in checkout', 1)
    expect(selected).toHaveLength(1)
  }, 20_000)
})
