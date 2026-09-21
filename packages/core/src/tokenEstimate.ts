import { encode } from 'gpt-tokenizer'

/**
 * Token counting is arithmetic, not judgment — always done in code, never asked of Jev
 * (see the "Jev constraints" section of the root CLAUDE.md).
 */
export function estimateTokens(text: string): number {
  return encode(text).length
}
