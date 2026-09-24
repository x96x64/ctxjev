import { splitCjkBigrams } from './cjk.js'

/**
 * An offline stand-in for Jev's relevance judgment: the share of the goal's significant words that
 * also appear in the entry. Far cruder than Jev (no synonyms, no understanding of "superseded"),
 * but it needs no API key or network and sends nothing anywhere — for when Jev isn't available.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'onto', 'was', 'were', 'are', 'but',
  'not', 'you', 'your', 'have', 'has', 'had', 'its', 'our', 'can', 'will', 'should', 'would', 'could',
  'when', 'where', 'what', 'which', 'why', 'how', 'all', 'any', 'some', 'there', 'then', 'than',
  'just', 'also', 'make', 'sure', 'fix', 'get', 'use', 'using', 'let', 'please',
])

// Crude on purpose: just enough that charge/charges/charged/charging all land on "charg".
function stem(word: string): string {
  let w = word
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2)
  else if (w.length > 4 && /(ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

// Mostly particles and inflection endings: Japanese's equivalent of STOPWORDS and stem().
const HIRAGANA = /\p{sc=Hiragana}+/gu

// CJK runs match as overlapping bigrams (see cjk.ts); everything else as stemmed words.
function terms(text: string): Set<string> {
  const { bigrams, rest } = splitCjkBigrams(text)
  const found = new Set(bigrams)
  rest
    .replace(HIRAGANA, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // chargeCustomer → charge Customer
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .forEach((word) => found.add(stem(word)))
  return found
}

// Scoring a batch calls this once per entry with the same goal.
let lastGoal: { text: string; terms: Set<string> } | undefined

export function localRelevance(goal: string, content: string): number {
  if (lastGoal?.text !== goal) lastGoal = { text: goal, terms: terms(goal) }
  const goalTerms = lastGoal.terms
  if (goalTerms.size === 0) return 0
  const contentTerms = terms(content)
  let hits = 0
  for (const term of goalTerms) if (contentTerms.has(term)) hits++
  return hits / goalTerms.size
}
