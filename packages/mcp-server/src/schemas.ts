import { z } from 'zod'

export const entrySchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  toolName: z.string().optional(),
  content: z.string(),
  timestamp: z.number(),
})

export const scoreRelevanceInput = {
  goal: z.string().describe('The current task/goal to judge each entry\'s relevance against.'),
  entries: z.array(entrySchema).describe('The agent history entries to score.'),
  recencyWeight: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('How much an entry\'s position in the batch (recency) should factor into its score, 0-1. Defaults to 0.1.'),
}

export const pruneHistoryInput = {
  ...scoreRelevanceInput,
  dropBelow: z.number().min(0).max(1).optional().describe('Combined-score floor below which an entry is dropped. Defaults to 0.25.'),
  summarizeBelow: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Combined-score floor below which an entry is summarized rather than kept verbatim. Defaults to 0.6.'),
}
