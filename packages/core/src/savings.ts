import { estimateTokens } from './tokenEstimate.js'
import type { Entry, PruneDecision } from './types.js'

export type SavingsReport = {
  totalEntries: number
  keptEntries: number
  droppedEntries: number
  summarizedEntries: number
  totalTokens: number
  /** Tokens in dropped entries — actually saved once they're removed. */
  droppedTokens: number
  /**
   * Tokens in entries marked `summarize`. ctxjev can't summarize (Jev doesn't generate text), so
   * how much of this is saved depends entirely on the caller's own summarizer — it's reported
   * separately rather than counted as saved.
   */
  summarizableTokens: number
}

export function summarizeSavings(entries: Entry[], decisions: PruneDecision[]): SavingsReport {
  const decisionByEntryId = new Map(decisions.map((d) => [d.entryId, d]))

  const report: SavingsReport = {
    totalEntries: entries.length,
    keptEntries: 0,
    droppedEntries: 0,
    summarizedEntries: 0,
    totalTokens: 0,
    droppedTokens: 0,
    summarizableTokens: 0,
  }

  for (const entry of entries) {
    const decision = decisionByEntryId.get(entry.id)
    if (!decision) {
      throw new Error(`no decision found for entry "${entry.id}" — entries and decisions must correspond 1:1`)
    }

    const tokens = entry.sourceTokens ?? estimateTokens(entry.content)
    report.totalTokens += tokens

    if (decision.action === 'drop') {
      report.droppedEntries++
      report.droppedTokens += tokens
    } else if (decision.action === 'summarize') {
      report.summarizedEntries++
      report.summarizableTokens += tokens
    } else {
      report.keptEntries++
    }
  }

  return report
}
