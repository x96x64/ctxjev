import type { JevUsage } from 'ctxjev-core'

/** Jev's published pricing: $0.042 per million input tokens, output free. */
const USD_PER_MILLION_INPUT_TOKENS = 0.042

export function estimateCostUsd(usage: JevUsage): number {
  return (usage.inputTokens / 1_000_000) * USD_PER_MILLION_INPUT_TOKENS
}
