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
  /** Jev's relevance probability (Noul), 0-1 — the sole signal `@typesafe-ai/sdk`'s noul() returns. */
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
  /** Below this relevance, an entry is dropped outright. */
  dropBelow: number
  /** Between dropBelow and this, an entry is summarized rather than kept verbatim or dropped. */
  summarizeBelow: number
  /** Weight applied to recency when combining with Jev's relevance score (0 = ignore recency entirely). */
  recencyWeight: number
}

/**
 * Tuned on Jev's probabilities (see the Design Notes in the README). Under the default `'recency'`
 * scorer, where every entry's relevance is its position, it drops roughly the oldest 30% of a batch
 * and summarizes the next 30%; under `'local'` keyword overlap, scores rarely reach 0.3, so most of a
 * batch drops.
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
