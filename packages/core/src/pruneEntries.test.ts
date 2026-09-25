import { describe, expect, it } from 'vitest'
import { pruneContext } from './prune.js'
import { pruneEntries } from './pruneEntries.js'
import { seededRandom } from './random.js'
import type { Entry, PruneDecision } from './types.js'

const entry = (id: string, role: Entry['role'], content = `content of ${id}`): Entry => ({ id, role, content, timestamp: Number(id.slice(1)) })
const decide = (entries: Entry[], drops: string[]): PruneDecision[] =>
  entries.map((e) => ({ entryId: e.id, relevance: 0, recency: 0, combinedScore: 0, action: drops.includes(e.id) ? 'drop' : 'keep' }))

// The third audit (4.1-2, check 12): prune on ctxjev's own format removed every entry marked drop.
// Under the default recency scorer the first request is oldest, so it went first, with no warning.
describe('pruneEntries', () => {
  const entries = [entry('e1', 'user', 'Fix the double charge on retry'), entry('e2', 'tool'), entry('e3', 'tool'), entry('e4', 'assistant'), entry('e5', 'tool'), entry('e6', 'tool')]

  it('keeps the first user entry and the last two by default, and says why', () => {
    const result = pruneEntries(entries, decide(entries, ['e1', 'e2', 'e5', 'e6']))
    expect(result.removed).toEqual(['e2'])
    expect(result.entries.map((e) => e.id)).toEqual(['e1', 'e3', 'e4', 'e5', 'e6'])
    expect(result.keptDrops).toEqual({ firstUserEntry: ['e1'], lastEntries: ['e5', 'e6'] })
    expect(result.firstUserEntryRemoved).toBeUndefined()
  })

  it('protects the first entry with role user, wherever it is', () => {
    const later = [entry('e1', 'tool'), entry('e2', 'user'), entry('e3', 'tool'), entry('e4', 'tool')]
    const result = pruneEntries(later, decide(later, ['e1', 'e2']), { protectLast: 0 })
    expect(result.removed).toEqual(['e1'])
    expect(result.keptDrops.firstUserEntry).toEqual(['e2'])
  })

  it('removes them too when protection is turned off, and names the first user entry it removed', () => {
    const result = pruneEntries(entries, decide(entries, ['e1', 'e2', 'e5', 'e6']), { protectFirstUserEntry: false, protectLast: 0 })
    expect(result.removed).toEqual(['e1', 'e2', 'e5', 'e6'])
    expect(result.firstUserEntryRemoved).toBe('e1')
  })

  it('counts saved tokens from sourceTokens when present, else the content', () => {
    const sized = [{ ...entry('e1', 'tool'), sourceTokens: 500 }, entry('e2', 'tool', 'hello world'), entry('e3', 'tool'), entry('e4', 'tool')]
    const result = pruneEntries(sized, decide(sized, ['e1', 'e2']))
    expect(result.savedTokens).toBe(500 + 2)
  })

  it('rejects decisions that don\'t match the entries one to one', () => {
    expect(() => pruneEntries(entries, decide(entries.slice(1), []))).toThrow(/no decision/)
  })

  // Every drop is either removed or kept for exactly one reason; nothing else is removed.
  it('accounts for every drop across random lists and settings', async () => {
    const random = seededRandom(5)
    for (let run = 0; run < 200; run++) {
      const list = Array.from({ length: Math.floor(random() * 12) }, (_, i) => entry(`e${i}`, random() < 0.3 ? 'user' : random() < 0.5 ? 'assistant' : 'tool'))
      const decisions = await pruneContext(list, 'goal', undefined, { scorer: async (_g, es) => es.map(() => random()) })
      const protectLast = Math.floor(random() * 4)
      const protectFirstUserEntry = random() < 0.5
      const result = pruneEntries(list, decisions, { protectLast, protectFirstUserEntry })
      const drops = decisions.filter((d) => d.action === 'drop').map((d) => d.entryId)
      const kept = [...result.keptDrops.firstUserEntry, ...result.keptDrops.lastEntries]
      for (const id of drops) expect(Number(result.removed.includes(id)) + kept.filter((k) => k === id).length).toBe(1)
      expect(result.removed.every((id) => drops.includes(id))).toBe(true)
      expect(result.entries.map((e) => e.id)).toEqual(list.filter((e) => !result.removed.includes(e.id)).map((e) => e.id))
      expect(list.slice(list.length - Math.min(protectLast, list.length)).every((e) => !result.removed.includes(e.id))).toBe(true)
      const firstUser = list.find((e) => e.role === 'user')
      if (firstUser && protectFirstUserEntry) expect(result.removed).not.toContain(firstUser.id)
      expect(result.firstUserEntryRemoved).toBe(firstUser && result.removed.includes(firstUser.id) ? firstUser.id : undefined)
    }
  })
})
