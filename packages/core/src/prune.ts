import { type ScoreCache } from './cache.js'
import { chunkEntries } from './chunk.js'
import { scoreRelevance, type JevClient, type RelevanceVerdict } from './jevClient.js'
import { localRelevance } from './localRelevance.js'
import { percentileRanks } from './percentile.js'
import { combineScore, decideAction } from './policy.js'
import { computeRecency } from './recency.js'
import { redactSecrets } from './redact.js'
import { DEFAULT_POLICY, type Entry, type JevUsage, type PruneDecision, type PruningPolicy, type ScoredEntry } from './types.js'

/**
 * Your own relevance judgment, for scoring with something other than Jev (another model, a
 * classifier, a rule set). It's called once per chunk of up to 50 entries, a few chunks at a time,
 * with the goal and every entry's content already passed through `redactSecrets()`; `latest` is
 * the batch's most recent activity, the same context Jev gets for spotting superseded entries.
 * Resolve to one relevance from 0 to 1 per entry, in the order given.
 */
export type CustomScorer = (goal: string, entries: Entry[], context: { latest: Entry[] }) => Promise<number[]>

export type ScoreEntriesOptions = {
  /** Called once per underlying Jev request (one per chunk) with that request's token usage. Jev only. */
  onUsage?: (usage: JevUsage) => void
  /** Checked before, and populated after, each Jev request — see `ScoreCache`. Jev only. */
  cache?: ScoreCache
  /** The client Jev requests go through. Jev only; defaults to one reading TYPESAFE_API_KEY. */
  jevClient?: JevClient
  /**
   * `'recency'` (default) ranks by position alone, newest 1 to oldest 0: plain truncation. On the
   * [preregistered holdout comparison](https://github.com/x96x64/ctxjev/blob/main/packages/core/eval/PREREGISTRATION.md),
   * `'jev'` tied it on task success, so it's opt-in rather than the default; pass `scorer: 'jev'`
   * to ask Jev instead, or `'local'` for offline keyword overlap. A function is used as-is (see
   * `CustomScorer`). Only `'jev'` reads or writes `cache` and calls `onUsage`.
   *
   * With `'recency'` the goal isn't used at all: relevance is position, so `DEFAULT_POLICY`'s
   * thresholds drop roughly the oldest 30% of entries and summarize the next 30%, whatever they say.
   */
  scorer?: 'jev' | 'local' | 'recency' | CustomScorer
}

/** The scorers `scorer` names, the default first. */
export const BUILT_IN_SCORERS = ['recency', 'local', 'jev'] as const

// A large transcript can chunk into hundreds of requests; firing all of them at once relies
// entirely on the SDK's own retry/backoff to survive the resulting rate-limit thundering herd.
export const MAX_CONCURRENT_CHUNK_REQUESTS = 5

// How much of the batch's most recent activity every chunk gets to see (see buildJevRequest).
const LATEST_CONTEXT_SIZE = 8

function latestEntries(entries: Entry[], count: number): Entry[] {
  return [...entries].sort((a, b) => a.timestamp - b.timestamp).slice(-count)
}

export async function mapWithConcurrencyLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    for (let i = nextIndex++; i < items.length; i = nextIndex++) {
      results[i] = await fn(items[i])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function scoreWithJev(entries: Entry[], goal: string, options: ScoreEntriesOptions): Promise<RelevanceVerdict[]> {
  const latest = latestEntries(entries, LATEST_CONTEXT_SIZE)
  const chunkResults = await mapWithConcurrencyLimit(chunkEntries(entries), MAX_CONCURRENT_CHUNK_REQUESTS, async (chunk) => {
    const { verdicts, usage } = await scoreRelevance(goal, chunk, options.cache, latest, options.jevClient)
    options.onUsage?.(usage)
    return verdicts
  })
  return chunkResults.flat()
}

async function scoreWithCustom(entries: Entry[], goal: string, scorer: CustomScorer): Promise<RelevanceVerdict[]> {
  const redact = (entry: Entry): Entry => ({ ...entry, content: redactSecrets(entry.content) })
  const latest = latestEntries(entries, LATEST_CONTEXT_SIZE).map(redact)
  const safeGoal = redactSecrets(goal)
  const chunkResults = await mapWithConcurrencyLimit(chunkEntries(entries), MAX_CONCURRENT_CHUNK_REQUESTS, async (chunk) => {
    const scores: unknown = await scorer(safeGoal, chunk.map(redact), { latest })
    if (!Array.isArray(scores) || scores.length !== chunk.length) {
      throw new Error(`custom scorer returned ${Array.isArray(scores) ? `${scores.length} scores` : String(scores)} for ${chunk.length} entries`)
    }
    return chunk.map((entry, i) => {
      const relevance: unknown = scores[i]
      if (typeof relevance !== 'number' || !Number.isFinite(relevance) || relevance < 0 || relevance > 1) {
        throw new Error(`custom scorer returned ${String(relevance)} for entry "${entry.id}" — expected a number from 0 to 1`)
      }
      return { entryId: entry.id, relevance }
    })
  })
  return chunkResults.flat()
}

function scoreLocally(entries: Entry[], goal: string): RelevanceVerdict[] {
  return entries.map((entry) => ({ entryId: entry.id, relevance: localRelevance(goal, entry.content) }))
}

// By position in the list, not timestamp: entries from one message share a timestamp but still have an order.
function scoreByRecency(entries: Entry[]): RelevanceVerdict[] {
  return entries.map((entry, i) => ({ entryId: entry.id, relevance: entries.length === 1 ? 1 : i / (entries.length - 1) }))
}

/**
 * Score every entry's relevance to `goal` via Jev, blended with its recency within this batch
 * (see `recency.ts`) per `recencyWeight` — but stop short of deciding what to actually do about
 * it. `pruneContext` (below) is `scoreEntries` plus that decision; call this directly when you
 * want the scores themselves (e.g. the MCP server's `score_relevance` tool, or to compare
 * policies against the same scores without re-querying Jev).
 */
export async function scoreEntries(
  entries: Entry[],
  goal: string,
  recencyWeight: number = DEFAULT_POLICY.recencyWeight,
  options: ScoreEntriesOptions = {},
): Promise<ScoredEntry[]> {
  const { scorer } = options
  // Types stop a TypeScript caller's typo; a JavaScript one ('Jev') would otherwise get recency in silence.
  if (scorer !== undefined && typeof scorer !== 'function' && !(BUILT_IN_SCORERS as readonly string[]).includes(scorer)) {
    throw new Error(`unknown scorer ${JSON.stringify(scorer)} — expected ${BUILT_IN_SCORERS.map((s) => `'${s}'`).join(', ')}, or a function`)
  }

  const seenIds = new Set<string>()
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new Error(`duplicate entry id "${entry.id}" — every entry must have a unique id`)
    }
    seenIds.add(entry.id)
  }

  const verdicts =
    scorer === 'local'
      ? scoreLocally(entries, goal)
      : scorer === 'jev'
        ? await scoreWithJev(entries, goal, options)
        : typeof scorer === 'function'
          ? await scoreWithCustom(entries, goal, scorer)
          : scoreByRecency(entries) // default: undefined or 'recency'

  const verdictByEntryId = new Map(verdicts.map((v) => [v.entryId, v]))
  const recencyByEntryId = computeRecency(entries)

  return entries.map((entry) => {
    const verdict = verdictByEntryId.get(entry.id)
    if (!verdict) {
      throw new Error(`no relevance verdict returned for entry ${entry.id}`)
    }
    const recency = recencyByEntryId.get(entry.id)!
    return {
      entryId: entry.id,
      relevance: verdict.relevance,
      recency,
      combinedScore: combineScore(verdict.relevance, recency, recencyWeight),
    }
  })
}

/**
 * `scoreEntries` plus applying `policy`'s thresholds to each combined score, deciding what to
 * keep, drop, or summarize. Entries are chunked into batches for the underlying fan-out
 * requests; order of the returned decisions matches the input order.
 *
 * The thresholds were tuned on Jev's probabilities. Keyword overlap (`'local'`) isn't on that
 * scale — most entries share only a word or two with the goal and score near 0, so the thresholds
 * used to drop nearly everything, relevant entries included. With `'local'`, each decision's
 * `relevance` is therefore the entry's percentile rank of keyword overlap within this batch (0
 * lowest, 1 highest, ties averaged), and `combinedScore` blends that with recency as usual. The
 * thresholds then read as shares of the batch. `scoreEntries` still returns the overlap itself.
 */
export async function pruneContext(
  entries: Entry[],
  goal: string,
  policy: PruningPolicy = DEFAULT_POLICY,
  options: ScoreEntriesOptions = {},
): Promise<PruneDecision[]> {
  let scored = await scoreEntries(entries, goal, policy.recencyWeight, options)
  if (options.scorer === 'local') {
    const ranks = percentileRanks(scored.map((s) => s.relevance))
    scored = scored.map((s, i) => ({ ...s, relevance: ranks[i], combinedScore: combineScore(ranks[i], s.recency, policy.recencyWeight) }))
  }
  return scored.map((entry) => ({ ...entry, action: decideAction(entry.combinedScore, policy) }))
}
