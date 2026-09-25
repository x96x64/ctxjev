export type EntryRole = 'user' | 'assistant' | 'tool'

/** One item of agent history under consideration for pruning. */
export type Entry = {
  id: string
  role: EntryRole
  toolName?: string
  /** Short text excerpt — not the full payload. Jev is billed per input token and isn't good with long documents. */
  content: string
  timestamp: number
  /**
   * Tokens in the full payload `content` was excerpted from — what removing this entry actually
   * saves. Set by the parsers that see the original (messagesToEntries, and
   * parseClaudeCodeTranscript with `countTokens`); savings fall back to `content` without it.
   */
  sourceTokens?: number
}

export type PruneAction = 'keep' | 'drop' | 'summarize'

export type ScoredEntry = {
  entryId: string
  /**
   * The scorer's relevance, 0-1: Jev's probability (Noul) under `'jev'`; keyword overlap under
   * `'local'` (in `pruneContext()`, its percentile rank within the batch); the entry's position
   * under `'recency'`, which ignores the goal; or what your `CustomScorer` returned.
   */
  relevance: number
  /** This entry's position in the batch, oldest=0 to newest=1 — see `recency.ts`. */
  recency: number
  /** `relevance` and `recency` blended per `PruningPolicy.recencyWeight` — what `decideAction` actually acts on. */
  combinedScore: number
}

export type PruneDecision = ScoredEntry & {
  action: PruneAction
}

export type PruningPolicy = {
  /** Below this `combinedScore`, an entry is marked `drop`. */
  dropBelow: number
  /**
   * Between `dropBelow` and this, an entry is marked `summarize`: worth shortening. ctxjev itself
   * only shortens one when `pruneMessages()` is given `summarize`; otherwise it's left as it is.
   */
  summarizeBelow: number
  /** Weight applied to recency when combining it with the scorer's relevance (0 = ignore recency entirely). */
  recencyWeight: number
}

/**
 * Tuned on Jev's probabilities (see the Design Notes in the README). Under the default `'recency'`
 * scorer, where every entry's relevance is its position, it drops roughly the oldest 30% of a batch
 * and summarizes the next 30%. Under `'local'`, `pruneContext` ranks keyword overlap within the
 * batch first (see there), so it drops roughly the 30% that overlap least with the goal.
 */
export const DEFAULT_POLICY: PruningPolicy = {
  dropBelow: 0.3,
  summarizeBelow: 0.6,
  recencyWeight: 0.1,
}

/** Token usage for one Jev request, straight from `@typesafe-ai/sdk`'s `SystemOneResult.usage`. */
export type JevUsage = {
  inputTokens: number
  outputTokens: number
}
