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

function terms(text: string): Set<string> {
  return new Set(
    text
      .replace(/([a-z])([A-Z])/g, '$1 $2') // chargeCustomer → charge Customer
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
      .map(stem),
  )
}

export function localRelevance(goal: string, content: string): number {
  const goalTerms = terms(goal)
  if (goalTerms.size === 0) return 0
  const contentTerms = terms(content)
  let hits = 0
  for (const term of goalTerms) if (contentTerms.has(term)) hits++
  return hits / goalTerms.size
}
