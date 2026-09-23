import { describe, expect, it } from 'vitest'
import { summarizeSavings } from './savings.js'
import type { Entry, PruneDecision } from './types.js'

const entries: Entry[] = [
  { id: 'a', role: 'tool', content: 'kept content here', timestamp: 0 },
  { id: 'b', role: 'tool', content: 'dropped content here', timestamp: 1 },
  { id: 'c', role: 'tool', content: 'summarized content here', timestamp: 2 },
]

const decisions: PruneDecision[] = [
  { entryId: 'a', action: 'keep', relevance: 0.9, recency: 0, combinedScore: 0.9 },
  { entryId: 'b', action: 'drop', relevance: 0.05, recency: 0.5, combinedScore: 0.05 },
  { entryId: 'c', action: 'summarize', relevance: 0.45, recency: 1, combinedScore: 0.45 },
]

describe('summarizeSavings', () => {
  it('counts entries by action', () => {
    const report = summarizeSavings(entries, decisions)
    expect(report.totalEntries).toBe(3)
    expect(report.keptEntries).toBe(1)
    expect(report.droppedEntries).toBe(1)
    expect(report.summarizedEntries).toBe(1)
  })

  it('reports dropped and summarizable tokens separately, never counting summarize as saved', () => {
    const report = summarizeSavings(entries, decisions)
    const tokensOf = (id: string) => summarizeSavings([entries.find((e) => e.id === id)!], [decisions.find((d) => d.entryId === id)!]).totalTokens
    expect(report.droppedTokens).toBe(tokensOf('b'))
    expect(report.summarizableTokens).toBe(tokensOf('c'))
    expect(report.totalTokens).toBe(tokensOf('a') + tokensOf('b') + tokensOf('c'))
  })

  it('throws instead of silently counting an entry with no matching decision as kept', () => {
    expect(() => summarizeSavings(entries, decisions.slice(1))).toThrow('no decision found for entry "a"')
  })
})
