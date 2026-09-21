import { describe, expect, it } from 'vitest'
import type { Entry, PruneDecision, SavingsReport } from 'ctxjev-core'
import { formatReport } from './report.js'

// picocolors' TTY/color-support detection differs between environments (a plain local shell vs.
// a CI runner vs. a real terminal) — stripping ANSI codes before asserting on substrings keeps
// these tests deterministic regardless of where they run, rather than depending on that detection.
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

const entries: Entry[] = [
  { id: 'a', role: 'tool', toolName: 'grep', content: 'the important finding', timestamp: 0 },
  { id: 'b', role: 'tool', toolName: 'ls', content: 'unrelated directory listing', timestamp: 1 },
]

const decisions: PruneDecision[] = [
  { entryId: 'a', action: 'keep', relevance: 0.95, recency: 1, combinedScore: 0.95 },
  { entryId: 'b', action: 'drop', relevance: 0.05, recency: 0, combinedScore: 0.05 },
]

const savings: SavingsReport = {
  totalEntries: 2,
  keptEntries: 1,
  droppedEntries: 1,
  summarizedEntries: 0,
  totalTokens: 10,
  savedTokens: 4,
}

describe('formatReport', () => {
  it('includes every entry id and its decision', () => {
    const report = stripAnsi(formatReport(entries, decisions, savings))
    expect(report).toContain('a')
    expect(report).toContain('b')
    expect(report).toContain('keep')
    expect(report).toContain('drop')
  })

  it('includes the summary counts and a token-savings percentage', () => {
    const report = stripAnsi(formatReport(entries, decisions, savings))
    expect(report).toContain('1 kept')
    expect(report).toContain('1 dropped')
    expect(report).toMatch(/40%/)
  })

  it('skips entries with no matching decision rather than throwing', () => {
    expect(() => formatReport(entries, [], savings)).not.toThrow()
  })
})
