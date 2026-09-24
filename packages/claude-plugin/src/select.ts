import { STATUS_MARKER } from './statusMarker.js'
import { DEFAULT_POLICY, isGoalCandidate, isSubstantiveMessage, scoreEntries, type Entry, type EntryRole, type ScoredEntry } from 'ctxjev-core'

export type SelectedEntry = ScoredEntry & { content: string }

export const DEFAULT_PRESERVE_LIMIT = 5

export type Scorer = 'jev' | 'local'

/**
 * Scores every entry against `goal` and returns the top `limit` by combined score — offline by
 * keyword overlap by default, or with Jev (the one call here that needs the live API) with
 * `scorer: 'jev'`.
 */
export async function selectPreserved(entries: Entry[], goal: string, limit = DEFAULT_PRESERVE_LIMIT, scorer: Scorer = 'local'): Promise<SelectedEntry[]> {
  if (entries.length === 0) return []

  const scored = await scoreEntries(entries, goal, undefined, { scorer })
  // Jev's probabilities share pruneContext's scale, so anything it would drop doesn't earn a slot
  // either. Keyword overlap isn't on that scale — any overlap at all is its only meaningful bar.
  const minRelevance = scorer === 'jev' ? DEFAULT_POLICY.dropBelow : Number.MIN_VALUE
  return rankForPreservation(scored, entries, goal, limit, minRelevance)
}

/**
 * Leaves out the messages the goal came from (the reminder's header already shows them), a short
 * acknowledgment like "yes, go ahead" (meaningless once what it answered is gone), ctxjev's own
 * status report (or a reply quoting it), a command the user ran (`/ctxjev:set-goal …` would only repeat the goal), and anything below `minRelevance`,
 * which shouldn't take a slot just for being recent.
 */
export function rankForPreservation(scored: ScoredEntry[], entries: Entry[], goal: string, limit: number, minRelevance: number): SelectedEntry[] {
  const entryById = new Map(entries.map((e) => [e.id, e]))
  const candidates = scored
    .map((s) => ({ ...s, content: entryById.get(s.entryId)?.content ?? '', role: entryById.get(s.entryId)?.role }))
    .filter((s) => s.relevance >= minRelevance && !restatesGoal(s.content, goal) && !s.content.includes(STATUS_MARKER))
    .filter((s) => s.role !== 'user' || (isSubstantiveMessage(s.content) && isGoalCandidate(s.content)))
    .sort((a, b) => b.combinedScore - a.combinedScore)

  // Walk in score order, skipping a candidate that's a near-duplicate of one already taken so the
  // next distinct candidate gets its slot instead of the same information twice.
  const taken: { role: EntryRole | undefined; words: Set<string> }[] = []
  const result: (ScoredEntry & { content: string; role?: EntryRole })[] = []
  for (const candidate of candidates) {
    if (result.length >= limit) break
    const words = dedupeWords(candidate.content, candidate.role)
    if (taken.some((t) => t.role === candidate.role && jaccard(words, t.words) >= DUPLICATE_OVERLAP)) continue
    taken.push({ role: candidate.role, words })
    result.push(candidate)
  }
  return result.map(({ role: _role, ...s }) => s)
}

// Above this, near-identical tool calls (e.g. `git show` run three different ways) are treated as
// the same information and only the first fills a slot.
const DUPLICATE_OVERLAP = 0.6

// Han, Katakana and Hangul run together without spaces, so overlapping character bigrams stand in
// for words there, the same approach core's localRelevance.ts uses for goal/content matching.
const CJK_RUN = /[\p{sc=Han}\p{sc=Katakana}\p{sc=Hangul}ーｰ]+/gu

function dedupeWords(content: string, role: EntryRole | undefined): Set<string> {
  const splitAt = role === 'tool' ? content.indexOf('): ') : -1
  const key = splitAt === -1 ? content : content.slice(splitAt + 3)
  const found = new Set<string>()
  for (const [run] of key.matchAll(CJK_RUN)) {
    const chars = [...run]
    for (let i = 0; i + 1 < chars.length; i++) found.add(chars[i] + chars[i + 1])
  }
  key
    .replace(CJK_RUN, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .forEach((word) => found.add(word))
  return found
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const word of a) if (b.has(word)) intersection++
  return intersection / (a.size + b.size - intersection)
}

// Part of the goal (a message it was inferred from), or the goal plus a few words ("Goal set: …",
// the confirmation after /ctxjev:set-goal): the reminder's header already shows it.
function restatesGoal(content: string, goal: string): boolean {
  const text = content.trim()
  return goal.includes(text) || (text.includes(goal.trim()) && !isSubstantiveMessage(text.replace(goal.trim(), '')))
}

/** CTXJEV_PRESERVE_LIMIT, if it's a whole number from 1 to 50; otherwise the default. */
/**
 * `CTXJEV_SCORER=jev` opts into Jev; anything else scores offline. Offline is the default because
 * on the preregistered holdout sessions keyword overlap retained more of what a task needed than
 * Jev did (packages/core/eval/PREREGISTRATION.md), and it sends nothing off the machine.
 */
export function scorerFromEnv(raw: string | undefined): Scorer {
  return raw?.trim().toLowerCase() === 'jev' ? 'jev' : 'local'
}

export function preserveLimitFromEnv(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_PRESERVE_LIMIT
}
