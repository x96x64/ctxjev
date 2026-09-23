import { z } from 'zod'
import { DEFAULT_POLICY, isValidPolicyOrdering } from 'ctxjev-core'

// Entries are billed per input token and, per ctxjev-core's own Entry doc, meant to be a short
// excerpt rather than a full payload — cap both dimensions at the MCP boundary instead of
// trusting every caller to already know that.
const MAX_ENTRIES = 500
const MAX_CONTENT_LENGTH = 4000
// goal gets embedded into state.goal on every chunked Jev request (jevClient.ts) — an oversized
// goal is billed once per chunk, not once per call, and deserves the same cap as content.
const MAX_GOAL_LENGTH = 2000

export const entrySchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'tool']),
  toolName: z.string().optional(),
  content: z.string().max(MAX_CONTENT_LENGTH),
  // .finite() — bare z.number() only rejects NaN, not Infinity/-Infinity. core's computeRecency
  // takes min/max across the whole batch, so one infinite timestamp turns every entry's recency
  // (and thus combinedScore) into NaN, not just the offending entry's.
  timestamp: z.number().finite(),
  sourceTokens: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Tokens in the full payload `content` was excerpted from, so the savings report counts what removing it actually saves.'),
})

export const scoreRelevanceInput = {
  goal: z.string().min(1).max(MAX_GOAL_LENGTH).describe('The current task/goal to judge each entry\'s relevance against.'),
  entries: z.array(entrySchema).max(MAX_ENTRIES).describe('The agent history entries to score.'),
  recencyWeight: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(`How much an entry's position in the batch (recency) should factor into its score, 0-1. Defaults to ${DEFAULT_POLICY.recencyWeight}.`),
}

export const pruneHistoryInput = {
  ...scoreRelevanceInput,
  dropBelow: z.number().min(0).max(1).optional().describe(`Combined-score floor below which an entry is dropped. Defaults to ${DEFAULT_POLICY.dropBelow}.`),
  summarizeBelow: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(`Combined-score floor below which an entry is summarized rather than kept verbatim. Defaults to ${DEFAULT_POLICY.summarizeBelow}.`),
}

/** dropBelow/summarizeBelow are each in range on their own, but nothing above stops a reversed
 * pair from making 'summarize' unreachable — check the actual values a call resolves to
 * (including the defaults) before running it. The invariant itself lives in ctxjev-core; this
 * just formats the MCP-facing field names into the error. */
export function validatePolicyOrdering(dropBelow: number, summarizeBelow: number): void {
  if (!isValidPolicyOrdering(dropBelow, summarizeBelow)) {
    throw new Error(`dropBelow (${dropBelow}) must not be greater than summarizeBelow (${summarizeBelow})`)
  }
}
