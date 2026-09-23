import { describe, expect, it } from 'vitest'
import type { Entry, JevUsage, PruneDecision, SavingsReport } from 'ctxjev-core'
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
  droppedTokens: 4,
  summarizableTokens: 0,
}

const usage: JevUsage = { inputTokens: 500, outputTokens: 55 }

describe('formatReport', () => {
  it('includes every entry id and its decision', () => {
    const report = stripAnsi(formatReport(entries, decisions, savings, usage))
    expect(report).toContain('a')
    expect(report).toContain('b')
    expect(report).toContain('keep')
    expect(report).toContain('drop')
  })

  it('includes the summary counts and a token-savings percentage', () => {
    const report = stripAnsi(formatReport(entries, decisions, savings, usage))
    expect(report).toContain('1 kept')
    expect(report).toContain('1 dropped')
    expect(report).toMatch(/40%/)
  })

  it('includes token usage and an estimated cost', () => {
    const report = stripAnsi(formatReport(entries, decisions, savings, usage))
    expect(report).toContain('500')
    expect(report).toContain('55')
    expect(report).toMatch(/\$0\.00002/)
  })

  it('skips entries with no matching decision rather than throwing', () => {
    expect(() => formatReport(entries, [], savings, usage)).not.toThrow()
  })

  it('labels an offline run instead of printing a Jev cost line', () => {
    const report = stripAnsi(formatReport(entries, decisions, savings, { inputTokens: 0, outputTokens: 0 }, 'local'))
    expect(report).toContain('Scored offline by keyword overlap')
    expect(report).not.toContain('Jev cost')
  })
})
