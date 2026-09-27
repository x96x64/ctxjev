import { encode } from 'gpt-tokenizer'
import { validateText } from './validate.js'

/**
 * Token counting is arithmetic, not judgment — always done in code, never asked of Jev
 * (see the "Jev constraints" section of the root CLAUDE.md).
 *
 * `encode()` merges byte pairs within one pre-token at a cost that grows with the square of its
 * length, and a pre-token has no length limit: a run of letters, of symbols (combining marks
 * included), or of whitespace is one pre-token however long it is, and so is a symbol followed by
 * any run of `/` and line breaks (`/\n/\n…`). 100,000 `█` took 82 seconds, a 5,000,000-character
 * entry didn't finish, and 200,000 characters of `!!` plus a combining accent overflowed the stack.
 * So a run of more than MAX_RUN of one of those kinds is counted in pieces of MAX_RUN (each
 * distinct piece encoded once), which leaves no pre-token longer than about twice MAX_RUN; text
 * with no such run counts exactly as `encode()` does. A cut run is an estimate, since each piece
 * is counted on its own: close on text such runs usually hold (a separator line hundreds of
 * characters long, a minified blob, Japanese with no punctuation for a page), but a long
 * repetitive run that merges into long tokens, such as capital letters repeated for thousands of
 * characters, counts well over the exact number.
 */
const MAX_RUN = 128
// The kinds a pre-token of o200k_base (gpt-tokenizer's default encoding) is a run of: letters and
// marks, anything but letters, digits, and whitespace (marks included), whitespace, and `/` with
// line breaks. Matched at most 8,192 characters at a time (a longer run is several matches in a
// row): a single match over millions of symbols overflowed the regular expression engine's stack.
const LONG_RUN = new RegExp(
  [`[\\p{L}\\p{M}]`, `[^\\s\\p{L}\\p{N}]`, `\\s`, `[\\r\\n/]`].map((kind) => `${kind}{${MAX_RUN + 1},8192}`).join('|'),
  'gu',
)
// Text that spells a special token (`<|endoftext|>`, which a conversation about language models
// can quote) is counted as the text it is; encode() refuses it by default.
const AS_TEXT = { disallowedSpecial: new Set<string>() }

// Pieces of a long run repeat (a separator line, a padded field), so each is encoded once.
const pieceCache = new Map<string, number>()
const PIECE_CACHE_LIMIT = 4096

function countPiece(piece: string): number {
  let tokens = pieceCache.get(piece)
  if (tokens === undefined) {
    tokens = encode(piece, AS_TEXT).length
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
  validateText(text, 'text')
  let tokens = 0
  let last = 0
  for (const match of text.matchAll(LONG_RUN)) {
    if (match.index > last) tokens += encode(text.slice(last, match.index), AS_TEXT).length
    tokens += countRun(match[0])
    last = match.index + match[0].length
  }
  return tokens + (last === 0 ? encode(text, AS_TEXT).length : last < text.length ? encode(text.slice(last), AS_TEXT).length : 0)
}
