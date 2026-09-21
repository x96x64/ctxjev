import { TypeSafeClient, noul } from '@typesafe-ai/sdk'
import type { Entry } from './types.js'

export type RelevanceVerdict = {
  entryId: string
  relevance: number
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
 */
let client: TypeSafeClient | undefined

// Constructed lazily, on first real use — not at module load — so importing ctxjev-core
// (e.g. just for its types, or for a CLI command that never calls Jev) doesn't require an
// API key to be present.
function getClient(): TypeSafeClient {
  client ??= new TypeSafeClient()
  return client
}

export async function scoreRelevance(goal: string, entries: Entry[]): Promise<RelevanceVerdict[]> {
  if (entries.length === 0) return []

  const state = {
    goal,
    entries: Object.fromEntries(
      entries.map((entry) => [entry.id, { role: entry.role, toolName: entry.toolName ?? null, content: entry.content }]),
    ),
  }

  const questions = Object.fromEntries(
    entries.map((entry) => [
      entry.id,
      noul(`Given state.entries["${entry.id}"], is this still relevant to accomplishing state.goal?`),
    ]),
  )

  const response = await getClient().systemOne({ state, questions })

  return entries.map((entry) => ({
    entryId: entry.id,
    relevance: response.answers[entry.id].noul,
  }))
}
