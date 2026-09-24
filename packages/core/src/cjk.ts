// Han, Katakana (plus its long-vowel mark, which Unicode files under Common) and Hangul are written
// without spaces between words, or with particles glued on, so a run of them can't be matched as a
// whole word, and a dictionary segmenter (Intl.Segmenter) splits katakana loanwords inconsistently
// (トークナイザー → トーク|ナイ|ザー). Overlapping character bigrams avoid both problems.
const CJK_RUN = /[\p{sc=Han}\p{sc=Katakana}\p{sc=Hangul}ーｰ]+/gu

/**
 * Splits `text` for word matching: overlapping character bigrams for every CJK run, and the rest of
 * the text with those runs blanked out, for the caller to split into words its own way. Shared by
 * the offline scorer (localRelevance.ts) and the Claude Code plugin's near-duplicate check.
 */
export function splitCjkBigrams(text: string): { bigrams: string[]; rest: string } {
  const bigrams: string[] = []
  for (const [run] of text.matchAll(CJK_RUN)) {
    const chars = [...run]
    for (let i = 0; i + 1 < chars.length; i++) bigrams.push(chars[i] + chars[i + 1])
  }
  return { bigrams, rest: text.replace(CJK_RUN, ' ') }
}
