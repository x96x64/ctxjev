// Shared by outcome.mjs and tasks.mjs: spend tracking, prompt caching, and the pruning conditions.
import { DEFAULT_POLICY, messagesToEntries, pruneMessages, scoreEntries } from '../dist/index.js'

export const ANSWER_MODEL = 'claude-haiku-4-5'
export const JUDGE_MODEL = 'claude-sonnet-5'
// $ per million tokens (input, output), from the Claude API price list. Cache writes bill at 1.25x
// input, cache reads at 0.1x.
const PRICES = { [ANSWER_MODEL]: [1, 5], [JUDGE_MODEL]: [2, 10] }

export class SpendLimitError extends Error {}

/** Dollars for one response's usage, cache reads and writes included. */
export function costOf(model, u) {
  const [inPrice, outPrice] = PRICES[model]
  return (u.input_tokens * inPrice + (u.cache_creation_input_tokens ?? 0) * inPrice * 1.25 + (u.cache_read_input_tokens ?? 0) * inPrice * 0.1 + u.output_tokens * outPrice) / 1e6
}

/** Totals every response's usage in dollars, and refuses further calls once `maxUsd` is spent. */
export function createSpend(maxUsd) {
  const byModel = {}
  let total = 0
  return {
    record(model, u) {
      const m = (byModel[model] ??= { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })
      m.input += u.input_tokens
      m.cacheWrite += u.cache_creation_input_tokens ?? 0
      m.cacheRead += u.cache_read_input_tokens ?? 0
      m.output += u.output_tokens
      total += costOf(model, u)
    },
    check() {
      if (total > maxUsd) throw new SpendLimitError(`spent $${total.toFixed(2)}, over --max-usd ${maxUsd}`)
    },
    get total() {
      return total
    },
    summary() {
      const parts = Object.entries(byModel).map(([model, m]) => `${model} ${m.input.toLocaleString()} in + ${m.cacheWrite.toLocaleString()} cache-write + ${m.cacheRead.toLocaleString()} cache-read / ${m.output.toLocaleString()} out`)
      return `${parts.join('; ')} — $${total.toFixed(2)}`
    },
  }
}

/** At most `n` calls of `fn` in flight at once, across everything that shares the limiter. */
export function createLimiter(n) {
  let active = 0
  const waiting = []
  return async (fn) => {
    if (active >= n) await new Promise((resolve) => waiting.push(resolve))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

/** A copy of `messages` with a prompt-cache breakpoint on the last block, so a later request that
 * extends the same history reads it from the cache. */
export function withCacheBreakpoint(messages) {
  const copy = messages.map((m) => ({ ...m }))
  const last = copy[copy.length - 1]
  const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content.map((b) => ({ ...b }))
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
  last.content = blocks
  return copy
}

export const firstText = (message) => message.content.find((b) => b.type === 'text')?.text?.trim() ?? ''

/** Relevance per entry id for each ranking strategy compared in the evals. */
export async function rankings(messages, goal) {
  const entries = messagesToEntries(messages)
  const byId = async (scorer) => new Map((await scoreEntries(entries, goal, 0, { scorer })).map((s) => [s.entryId, s.relevance]))
  return {
    jev: await byId('jev'),
    keywords: await byId('local'),
    recency: new Map(entries.map((e, i) => [e.id, entries.length === 1 ? 1 : i / (entries.length - 1)])),
  }
}

/** `messages` cut to `budget` (a share of its own tokens) by dropping lowest-ranked entries first.
 * Jev and keywords blend in recency at the shipped default; the recency ranking is recency alone.
 * `extra` passes further pruneMessages options (keepUserText, marker). */
export async function pruneTo(messages, goal, ranking, strategy, budget, extra = {}) {
  const total = messagesToEntries(messages).reduce((sum, e) => sum + e.sourceTokens, 0)
  const { messages: pruned } = await pruneMessages(messages, goal, {
    scorer: async (_goal, entries) => entries.map((e) => ranking.get(e.id)),
    policy: { dropBelow: 0, summarizeBelow: 0, recencyWeight: strategy === 'recency' ? 0 : DEFAULT_POLICY.recencyWeight },
    targetTokens: Math.floor(total * budget),
    keepUserText: extra.keepUserText ?? false,
    marker: extra.marker ?? false,
  })
  return pruned
}
