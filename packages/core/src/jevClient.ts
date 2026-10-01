import { TypeSafeClient, noul } from '@typesafe-ai/sdk'
import { missingTypesafeApiKey, typesafeApiKey } from './apiKey.js'
import { cacheKeyFor, type ScoreCache } from './cache.js'
import { truncate } from './entryText.js'
import { redactSecrets } from './redact.js'
import type { Entry, JevUsage } from './types.js'
import { shown } from './validate.js'

export type RelevanceVerdict = {
  entryId: string
  relevance: number
}

export type ScoreRelevanceResult = {
  verdicts: RelevanceVerdict[]
  usage: JevUsage
}

/**
 * The one module that talks to Jev. Each chunk is one request: every entry becomes a named `noul`
 * question against a shared state. The SDK reads TYPESAFE_API_KEY and retries transient failures
 * (408/429/5xx, timeouts) itself.
 */
const LATEST_CONTENT_LENGTH = 200

/**
 * What scoring needs from a Jev client. `@typesafe-ai/sdk`'s `TypeSafeClient` is one; pass your own
 * (`ScoreEntriesOptions.jevClient`) to configure it differently, or a fake in a test.
 */
export type JevClient = Pick<TypeSafeClient, 'systemOne'>

let client: TypeSafeClient | undefined

// Constructed lazily, on first real use — not at module load — so importing ctxjev-core
// (e.g. just for its types, or for a CLI command that never calls Jev) doesn't require an
// API key to be present.
function getClient(): JevClient {
  if (client) return client
  // Never constructed without a usable key: the SDK would send an unexpanded placeholder as one.
  const apiKey = typesafeApiKey()
  if (apiKey === undefined) throw new Error(`${missingTypesafeApiKey()}: get one at console.typesafe.ai/settings/keys`)
  client = new TypeSafeClient({ apiKey })
  return client
}

/**
 * Everything sent to Jev for one chunk. This is the single point where entry content leaves the
 * machine, so it's also where secrets are masked — every caller (CLI, MCP server, Claude Code
 * plugin, a library user's own agent loop) goes through here. Goal, content, and tool names are
 * masked; entry ids aren't sent at all. An id is whatever the caller chose (a tool_use_id, a record
 * uuid, anything an MCP client passed), so each request names its entries `e0`, `e1`, … in order
 * instead, and `questionIds[i]` is the name `entries[i]` got.
 *
 * `latest` is the most recent activity across the *whole* batch, shared with every chunk: without
 * it, an old failing test and the later run that fixed it could land in different chunks, and the
 * old failure would be judged with no way to see it was superseded.
 */
export function buildJevRequest(goal: string, entries: Entry[], latest: Entry[] = []) {
  const brief = (entry: Entry, maxLength?: number) => ({
    role: entry.role,
    toolName: entry.toolName === undefined ? null : redactSecrets(entry.toolName),
    content: maxLength ? truncate(redactSecrets(entry.content), maxLength) : redactSecrets(entry.content),
  })

  const questionIds = entries.map((_, i) => `e${i}`)
  const state = {
    goal: redactSecrets(goal),
    entries: Object.fromEntries(entries.map((entry, i) => [questionIds[i], brief(entry)])),
    ...(latest.length > 0 && { latest: latest.map((entry) => brief(entry, LATEST_CONTENT_LENGTH)) }),
  }

  const context = latest.length > 0 ? ', given where the work currently stands (state.latest)' : ''
  const questions = Object.fromEntries(
    questionIds.map((id) => [id, noul(`Given state.entries[${JSON.stringify(id)}], is this still relevant to accomplishing state.goal${context}?`)]),
  )

  return { state, questions, questionIds }
}

/**
 * `cache`, when provided, is checked before spending a Jev request on an entry and populated with
 * fresh verdicts afterward. Keyed on goal, entry content, and `latest` (see `cacheKeyFor`), not on
 * `entry.id`, so the same history scores as a hit across transcripts. `jev` defaults to a
 * `TypeSafeClient` with the key `typesafeApiKey()` finds (none: an error, and nothing sent) and
 * TYPESAFE_BASE_URL from the environment.
 */
export async function scoreRelevance(
  goal: string,
  entries: Entry[],
  cache?: ScoreCache,
  latest: Entry[] = [],
  jev?: JevClient,
): Promise<ScoreRelevanceResult> {
  if (entries.length === 0) {
    return { verdicts: [], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  const relevanceByEntryId = new Map<string, number>()
  const uncached: Entry[] = []
  for (const entry of entries) {
    const hit = cache?.get(cacheKeyFor(goal, entry, latest))
    if (hit !== undefined) relevanceByEntryId.set(entry.id, hit)
    else uncached.push(entry)
  }

  let usage: JevUsage = { inputTokens: 0, outputTokens: 0 }

  if (uncached.length > 0) {
    const { state, questions, questionIds } = buildJevRequest(goal, uncached, latest)
    const response = await (jev ?? getClient()).systemOne({ state, questions })
    usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }

    // Every answer is checked before any is used or cached: a probability that isn't a finite number
    // from 0 to 1 is an error, not a score (the fourth audit's P2-12), and one bad answer means the
    // response can't be trusted for the rest of the batch either.
    const answered = uncached.map((entry, i) => {
      const answer = response.answers[questionIds[i]]
      if (!answer) {
        throw new Error(`Jev returned no answer for entry "${entry.id}" — the response is missing this question`)
      }
      const relevance: unknown = answer.noul
      if (typeof relevance !== 'number' || !Number.isFinite(relevance) || relevance < 0 || relevance > 1) {
        throw new Error(`Jev returned an invalid probability for entry "${entry.id}": ${shown(relevance)} — expected a number from 0 to 1`)
      }
      return { entry, relevance }
    })
    for (const { entry, relevance } of answered) {
      relevanceByEntryId.set(entry.id, relevance)
      cache?.set(cacheKeyFor(goal, entry, latest), relevance)
    }
  }

  const verdicts = entries.map((entry) => ({
    entryId: entry.id,
    relevance: relevanceByEntryId.get(entry.id)!,
  }))

  return { verdicts, usage }
}
