import type { Entry, ScoredEntry } from 'ctxjev-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESERVE_LIMIT, preserveLimitFromEnv, rankForPreservation, selectPreserved } from './select.js'

const entries: Entry[] = [
  { id: 'goal', role: 'user', content: 'fix the double charge', timestamp: 0 },
  { id: 'a', role: 'tool', content: 'the retry handler re-charges', timestamp: 1 },
  { id: 'b', role: 'tool', content: 'unrelated listing', timestamp: 2 },
]

const scored: ScoredEntry[] = [
  { entryId: 'goal', relevance: 0.99, recency: 0, combinedScore: 0.99 },
  { entryId: 'a', relevance: 0.9, recency: 0.5, combinedScore: 0.86 },
  { entryId: 'b', relevance: 0.1, recency: 1, combinedScore: 0.19 },
]

describe('selectPreserved', () => {
  it('returns an empty array for no entries without calling Jev', async () => {
    expect(await selectPreserved([], 'goal')).toEqual([])
  })
})

describe('rankForPreservation', () => {
  it('ranks by combined score and carries each entry’s content', () => {
    expect(rankForPreservation(scored, entries, 'something else', 5, Number.MIN_VALUE).map((s) => [s.entryId, s.content])).toEqual([
      ['goal', 'fix the double charge'],
      ['a', 'the retry handler re-charges'],
      ['b', 'unrelated listing'],
    ])
  })

  it('leaves out the message the goal itself came from', () => {
    expect(rankForPreservation(scored, entries, 'fix the double charge', 5, Number.MIN_VALUE).map((s) => s.entryId)).toEqual(['a', 'b'])
  })

  it('respects the limit', () => {
    expect(rankForPreservation(scored, entries, 'x', 1, Number.MIN_VALUE)).toHaveLength(1)
  })

  it('leaves out entries with zero relevance, however recent', () => {
    const withZero: ScoredEntry[] = [...scored.slice(0, 2), { entryId: 'b', relevance: 0, recency: 1, combinedScore: 0.1 }]
    expect(rankForPreservation(withZero, entries, 'x', 5, Number.MIN_VALUE).map((s) => s.entryId)).toEqual(['goal', 'a'])
  })

  it('leaves out entries below the minimum relevance, even when that leaves slots empty', () => {
    // b's relevance (0.1) is below 0.25, even though recency pushes its combined score up
    expect(rankForPreservation(scored, entries, 'x', 5, 0.25).map((s) => s.entryId)).toEqual(['goal', 'a'])
  })
})

describe('rankForPreservation, near-duplicates', () => {
  it('keeps one of several near-identical tool calls and fills the freed slots with the next distinct entries', () => {
    const dupEntries: Entry[] = [
      { id: 'show', role: 'tool', toolName: 'Bash', content: 'Bash(git show ac24b85): commit ac24b85 Author: Luis Ortega Date: Mon Sep 22 fix the double charge on retry', timestamp: 1 },
      { id: 'stat', role: 'tool', toolName: 'Bash', content: 'Bash(git show ac24b85 --stat): commit ac24b85 Author: Luis Ortega Date: Mon Sep 22 fix the double charge on retry, 2 files changed', timestamp: 2 },
      { id: 'range', role: 'tool', toolName: 'Bash', content: 'Bash(git show ac24b85^..ac24b85): commit ac24b85 Author: Luis Ortega Date: Mon Sep 22 fix the double charge on retry', timestamp: 3 },
      { id: 'diff', role: 'tool', toolName: 'Bash', content: 'Bash(git diff ac24b85^..ac24b85 --stat): commit ac24b85 Author: Luis Ortega Date: Mon Sep 22 fix the double charge on retry, 2 files changed', timestamp: 4 },
      { id: 'other1', role: 'tool', toolName: 'Bash', content: 'Bash(npm test): 42 passing, 0 failing', timestamp: 5 },
      { id: 'other2', role: 'tool', toolName: 'Bash', content: 'Bash(git status): nothing to commit, working tree clean', timestamp: 6 },
    ]
    const dupScored: ScoredEntry[] = [
      { entryId: 'show', relevance: 0.72, recency: 0.9, combinedScore: 0.75 },
      { entryId: 'stat', relevance: 0.72, recency: 0.8, combinedScore: 0.74 },
      { entryId: 'range', relevance: 0.72, recency: 0.7, combinedScore: 0.73 },
      { entryId: 'diff', relevance: 0.72, recency: 0.6, combinedScore: 0.72 },
      { entryId: 'other1', relevance: 0.5, recency: 0.5, combinedScore: 0.5 },
      { entryId: 'other2', relevance: 0.4, recency: 0.4, combinedScore: 0.4 },
    ]
    const ids = rankForPreservation(dupScored, dupEntries, 'x', 5, Number.MIN_VALUE).map((s) => s.entryId)
    expect(ids).toEqual(['show', 'other1', 'other2'])
  })

  it('keeps two entries that merely share a few words', () => {
    const shared: Entry[] = [
      { id: 'one', role: 'tool', toolName: 'Bash', content: 'Bash(cat src/billing.ts): export function chargeCustomer(amount) { return charge(amount) }', timestamp: 1 },
      { id: 'two', role: 'tool', toolName: 'Bash', content: 'Bash(cat src/inventory.ts): export function reorderStock(sku) { return submitPurchaseOrder(sku) }', timestamp: 2 },
    ]
    const sharedScored: ScoredEntry[] = [
      { entryId: 'one', relevance: 0.7, recency: 0.9, combinedScore: 0.8 },
      { entryId: 'two', relevance: 0.7, recency: 0.8, combinedScore: 0.75 },
    ]
    expect(rankForPreservation(sharedScored, shared, 'x', 5, Number.MIN_VALUE).map((s) => s.entryId)).toEqual(['one', 'two'])
  })

  it('dedupes near-identical Japanese tool results using character bigrams', () => {
    const ja: Entry[] = [
      { id: 'a', role: 'tool', toolName: 'Bash', content: 'Bash(git show abc123): コミット abc123 は 二重課金のリトライ処理を修正しました', timestamp: 1 },
      { id: 'b', role: 'tool', toolName: 'Bash', content: 'Bash(git show abc123 --stat): コミット abc123 は 二重課金のリトライ処理を修正した内容です', timestamp: 2 },
      { id: 'c', role: 'tool', toolName: 'Bash', content: 'Bash(npm test): テストは 42 件成功、0 件失敗しました', timestamp: 3 },
    ]
    const jaScored: ScoredEntry[] = [
      { entryId: 'a', relevance: 0.72, recency: 0.9, combinedScore: 0.8 },
      { entryId: 'b', relevance: 0.72, recency: 0.8, combinedScore: 0.75 },
      { entryId: 'c', relevance: 0.5, recency: 0.5, combinedScore: 0.5 },
    ]
    expect(rankForPreservation(jaScored, ja, 'x', 5, Number.MIN_VALUE).map((s) => s.entryId)).toEqual(['a', 'c'])
  })
})

describe('preserveLimitFromEnv', () => {
  it('accepts a whole number from 1 to 50', () => {
    expect(preserveLimitFromEnv('10')).toBe(10)
  })

  it('falls back to the default for anything else', () => {
    for (const raw of [undefined, '', '0', '-3', '2.5', '51', 'lots']) {
      expect(preserveLimitFromEnv(raw)).toBe(DEFAULT_PRESERVE_LIMIT)
    }
  })
})

describe('rankForPreservation, acknowledgments', () => {
  it('leaves out a short user acknowledgment even when it scores high', () => {
    const withAck: Entry[] = [...entries, { id: 'ack', role: 'user', content: 'yes go ahead', timestamp: 3 }]
    const withAckScored: ScoredEntry[] = [...scored, { entryId: 'ack', relevance: 0.8, recency: 1, combinedScore: 0.82 }]
    expect(rankForPreservation(withAckScored, withAck, 'x', 5, Number.MIN_VALUE).map((s) => s.entryId)).not.toContain('ack')
  })

  it('leaves out a command the user ran, such as the /ctxjev:set-goal that set the goal', () => {
    const content = '<command-name>/ctxjev:set-goal</command-name> <command-args>Stop the double charge on retry</command-args>'
    const withCommand: Entry[] = [...entries, { id: 'cmd', role: 'user', content, timestamp: 3 }]
    const withCommandScored: ScoredEntry[] = [...scored, { entryId: 'cmd', relevance: 1, recency: 1, combinedScore: 1 }]
    expect(rankForPreservation(withCommandScored, withCommand, 'Stop the double charge on retry', 5, Number.MIN_VALUE).map((s) => s.entryId)).not.toContain('cmd')
  })

  it("leaves out ctxjev's own status report, and a reply that quotes it", () => {
    const report = 'Bash(node status.js s1): ctxjev status — session s1 A diagnostic report…'
    const echo = '```text ctxjev status — session s1 Next compaction scores against …```'
    const withReport: Entry[] = [...entries, { id: 'r', role: 'tool', toolName: 'Bash', content: report, timestamp: 3 }, { id: 'e', role: 'assistant', content: echo, timestamp: 4 }]
    const withReportScored: ScoredEntry[] = [...scored, { entryId: 'r', relevance: 1, recency: 1, combinedScore: 1 }, { entryId: 'e', relevance: 1, recency: 1, combinedScore: 1 }]
    const ids = rankForPreservation(withReportScored, withReport, 'x', 5, Number.MIN_VALUE).map((s) => s.entryId)
    expect(ids).not.toContain('r')
    expect(ids).not.toContain('e')
  })

  it('leaves out the confirmation that only repeats the goal, but keeps a reply that says more', () => {
    const goal = 'computeTotal を banker\'s rounding で直す'
    const withReplies: Entry[] = [
      ...entries,
      { id: 'ok', role: 'assistant', content: `Goal set: ${goal}`, timestamp: 3 },
      { id: 'more', role: 'assistant', content: `${goal} ために、toCents の Math.round を偶数丸めに変え、src/legacy は触らずにテストを追加します。`, timestamp: 4 },
    ]
    const withRepliesScored: ScoredEntry[] = [...scored, { entryId: 'ok', relevance: 1, recency: 1, combinedScore: 1 }, { entryId: 'more', relevance: 1, recency: 1, combinedScore: 1 }]
    const ids = rankForPreservation(withRepliesScored, withReplies, goal, 5, Number.MIN_VALUE).map((s) => s.entryId)
    expect(ids).not.toContain('ok')
    expect(ids).toContain('more')
  })
})
