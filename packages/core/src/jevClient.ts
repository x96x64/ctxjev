import { TypeSafeClient, noul } from '@typesafe-ai/sdk'
import { cacheKeyFor, type ScoreCache } from './cache.js'
import { truncate } from './entryText.js'
import { redactSecrets } from './redact.js'
import type { Entry, JevUsage } from './types.js'

export type RelevanceVerdict = {
  entryId: string
  relevance: number
}

export type ScoreRelevanceResult = {
  verdicts: RelevanceVerdict[]
  usage: JevUsage
}

/**
 * Thin wrapper over @typesafe-ai/sdk. Kept as its own module so the fan-out/request-shaping
 * logic has exactly one place to change if Jev's request format or limits change.
 *
 * One request per chunk: every entry becomes its own named `noul` question ("is this still
 * relevant to state.goal?"), all evaluated in parallel against a single shared state — Jev's
 * cost barely grows with question count, so this is one round trip per chunk, not per entry.
 * Requires TYPESAFE_API_KEY in the environment (the SDK reads it directly; no key is passed
 * here explicitly).
 *
 * No hand-rolled retry logic here — `TypeSafeClient`'s own `RetryPolicy` already retries
 * connection failures, timeouts, and 408/429/500-599 responses by default (see
 * `@typesafe-ai/sdk`'s `RetryPolicy` type). Re-implementing that here would just be a worse copy
 * of what the SDK already does correctly.
 */
const LATEST_CONTENT_LENGTH = 200

let client: TypeSafeClient | undefined

// Constructed lazily, on first real use — not at module load — so importing ctxjev-core
// (e.g. just for its types, or for a CLI command that never calls Jev) doesn't require an
// API key to be present.
function getClient(): TypeSafeClient {
  client ??= new TypeSafeClient()
  return client
}

/**
 * Everything sent to Jev for one chunk. This is the single point where entry content leaves the
 * machine, so it's also where secrets are masked — every caller (CLI, MCP server, Claude Code
 * plugin, a library user's own agent loop) goes through here.
 *
 * `latest` is the most recent activity across the *whole* batch, shared with every chunk: without
 * it, an old failing test and the later run that fixed it could land in different chunks, and the
 * old failure would be judged with no way to see it was superseded.
 */
export function buildJevRequest(goal: string, entries: Entry[], latest: Entry[] = []) {
  const brief = (entry: Entry, maxLength?: number) => ({
    role: entry.role,
    toolName: entry.toolName ?? null,
    content: maxLength ? truncate(redactSecrets(entry.content), maxLength) : redactSecrets(entry.content),
  })

  const state = {
    goal: redactSecrets(goal),
    entries: Object.fromEntries(entries.map((entry) => [entry.id, brief(entry)])),
    ...(latest.length > 0 && { latest: latest.map((entry) => brief(entry, LATEST_CONTENT_LENGTH)) }),
  }

  const context = latest.length > 0 ? ', given where the work currently stands (state.latest)' : ''
  const questions = Object.fromEntries(
    entries.map((entry) => [
      entry.id,
      noul(`Given state.entries[${JSON.stringify(entry.id)}], is this still relevant to accomplishing state.goal${context}?`),
    ]),
  )

  return { state, questions }
}

/**
 * `cache`, when provided, is checked before spending a Jev request on an entry — and populated
 * with any fresh verdicts afterward. Keyed on goal + entry content (see `cacheKeyFor`), not on
 * `entry.id`, so the same tool output scores as a cache hit even across different transcripts.
 */
export async function scoreRelevance(goal: string, entries: Entry[], cache?: ScoreCache, latest: Entry[] = []): Promise<ScoreRelevanceResult> {
  if (entries.length === 0) {
    return { verdicts: [], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  const relevanceByEntryId = new Map<string, number>()
  const uncached: Entry[] = []
  for (const entry of entries) {
    const hit = cache?.get(cacheKeyFor(goal, entry))
    if (hit !== undefined) relevanceByEntryId.set(entry.id, hit)
    else uncached.push(entry)
  }

  let usage: JevUsage = { inputTokens: 0, outputTokens: 0 }

  if (uncached.length > 0) {
    const { state, questions } = buildJevRequest(goal, uncached, latest)
    const response = await getClient().systemOne({ state, questions })
    usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }

    for (const entry of uncached) {
      const answer = response.answers[entry.id]
      if (!answer) {
        throw new Error(`Jev returned no answer for entry "${entry.id}" — the response is missing this question`)
      }
      const relevance = answer.noul
      relevanceByEntryId.set(entry.id, relevance)
      cache?.set(cacheKeyFor(goal, entry), relevance)
    }
  }

  const verdicts = entries.map((entry) => ({
    entryId: entry.id,
    relevance: relevanceByEntryId.get(entry.id)!,
  }))

  return { verdicts, usage }
}
