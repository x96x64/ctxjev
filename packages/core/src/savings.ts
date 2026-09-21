import { estimateTokens } from './tokenEstimate.js'
import type { Entry, PruneDecision } from './types.js'

export type SavingsReport = {
  totalEntries: number
  keptEntries: number
  droppedEntries: number
  summarizedEntries: number
  totalTokens: number
  savedTokens: number
}

/** Summarized entries are counted as fully saved — the caller decides how to actually shorten them. */
export function summarizeSavings(entries: Entry[], decisions: PruneDecision[]): SavingsReport {
  const decisionByEntryId = new Map(decisions.map((d) => [d.entryId, d]))

  let totalTokens = 0
  let savedTokens = 0
  let keptEntries = 0
  let droppedEntries = 0
  let summarizedEntries = 0

  for (const entry of entries) {
    const tokens = estimateTokens(entry.content)
    totalTokens += tokens

    const decision = decisionByEntryId.get(entry.id)
    if (!decision) {
      throw new Error(`no decision found for entry "${entry.id}" — entries and decisions must correspond 1:1`)
    }

    if (decision.action === 'drop' || decision.action === 'summarize') {
      savedTokens += tokens
      if (decision.action === 'drop') droppedEntries++
      else summarizedEntries++
    } else {
      keptEntries++
    }
  }

  return {
    totalEntries: entries.length,
    keptEntries,
    droppedEntries,
    summarizedEntries,
    totalTokens,
    savedTokens,
  }
}
