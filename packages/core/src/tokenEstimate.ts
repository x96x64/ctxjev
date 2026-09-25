import { encode } from 'gpt-tokenizer'

/**
 * Token counting is arithmetic, not judgment — always done in code, never asked of Jev
 * (see the "Jev constraints" section of the root CLAUDE.md).
 *
 * `encode()` merges byte pairs within one pre-token at a cost that grows with the square of its
 * length, and a run of letters, of symbols, or of whitespace with nothing to break it is one
 * pre-token however long it is: 100,000 `█` took 82 seconds, and a 5,000,000-character entry
 * didn't finish. So a run longer than MAX_RUN characters is counted in pieces of MAX_RUN (each
 * distinct piece encoded once), and everything around it exactly as before. It's an estimate:
 * each cut can move the count by a token or so, on text that's rare in practice (a separator line
 * hundreds of characters long, a minified blob, Japanese with no punctuation for a page).
 */
const MAX_RUN = 128
// Matched at most 8,192 characters at a time (a longer run is several matches in a row): a single
// match over millions of symbols overflowed the regular expression engine's stack.
const LONG_RUN = new RegExp(
  [`[\\p{L}\\p{M}]`, `[^\\s\\p{L}\\p{M}\\p{N}]`, `\\s`].map((kind) => `${kind}{${MAX_RUN + 1},8192}`).join('|'),
  'gu',
)

// Pieces of a long run repeat (a separator line, a padded field), so each is encoded once.
const pieceCache = new Map<string, number>()
const PIECE_CACHE_LIMIT = 4096

function countPiece(piece: string): number {
  let tokens = pieceCache.get(piece)
  if (tokens === undefined) {
    tokens = encode(piece).length
    if (pieceCache.size >= PIECE_CACHE_LIMIT) pieceCache.clear()
    pieceCache.set(piece, tokens)
  }
  return tokens
}

/** Cuts every MAX_RUN code points, never between the two halves of a surrogate pair. */
function countRun(run: string): number {
  let tokens = 0
  let start = 0
  while (start < run.length) {
    let end = start
    for (let n = 0; n < MAX_RUN && end < run.length; n++) end += run.codePointAt(end)! > 0xffff ? 2 : 1
    tokens += countPiece(run.slice(start, end))
    start = end
  }
  return tokens
}

export function estimateTokens(text: string): number {
  let tokens = 0
  let last = 0
  for (const match of text.matchAll(LONG_RUN)) {
    if (match.index > last) tokens += encode(text.slice(last, match.index)).length
    tokens += countRun(match[0])
    last = match.index + match[0].length
  }
  return tokens + (last === 0 ? encode(text).length : last < text.length ? encode(text.slice(last)).length : 0)
}
