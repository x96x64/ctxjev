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
    recency: await byId('recency'),
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

function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 95% bootstrap interval for `stat(rows)`, resampling whole clusters (a task or a session) rather
 * than single rows: runs of the same task aren't independent, and treating them as if they were
 * would make the interval look tighter than the evidence is. Seeded, so reruns print the same.
 */
export function bootstrap(rows, clusterOf, stat, resamples = 5000) {
  const clusters = [...Map.groupBy(rows, clusterOf).values()]
  const random = seededRandom(20260923)
  const values = []
  for (let i = 0; i < resamples; i++) {
    const sample = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]).flat()
    const v = stat(sample)
    if (!Number.isNaN(v)) values.push(v)
  }
  values.sort((a, b) => a - b)
  return [values[Math.floor(values.length * 0.025)], values[Math.floor(values.length * 0.975)]]
}

export const successRate = (key) => (rows) => (rows.length === 0 ? NaN : rows.filter((r) => r[key]).length / rows.length)

/** Mean of `key` under condition a minus under condition b, within the same resampled clusters. */
export const rateDifference = (key, isA, isB) => (rows) => successRate(key)(rows.filter(isA)) - successRate(key)(rows.filter(isB))

/**
 * Answering a probe question from a (possibly pruned) conversation, and grading the answer against
 * the probe's fact. Shared by outcome.mjs and plugin.mjs so both ask and grade the same way.
 */
export function createQA({ client, spend, limit }) {
  // Histories carry tool_use blocks, so the request declares those tools, but never lets the model call one.
  function toolsFor(messages) {
    const names = new Set()
    for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') names.add(b.name)
    return [...names].sort().map((name) => ({ name, description: `The ${name} tool used earlier in this session.`, input_schema: { type: 'object', additionalProperties: true } }))
  }

  async function call(model, params) {
    spend.check()
    const response = await limit(() => client.messages.create({ model, ...params }))
    spend.record(model, response.usage)
    return response
  }

  // Without the note, a model primed by a tool-heavy session sometimes answers with a tool call,
  // which tool_choice "none" strips to an empty reply; the first run lost 8% of its answers that way.
  const PLAIN_TEXT_NOTE = '\n\n(Answer in plain text from the conversation above. No tools are available for this question.)'

  async function answer(history, question) {
    const reply = await ask(history, `${question}${PLAIN_TEXT_NOTE}`)
    return reply || ask(history, `${question}${PLAIN_TEXT_NOTE} Do not call any tool; write the answer.`)
  }

  async function ask(history, question) {
    const tools = toolsFor(history)
    const response = await call(ANSWER_MODEL, {
      max_tokens: 400,
      temperature: 0,
      system:
        'The conversation above is a coding session. The last message is a question about it, not a request to continue the work: ' +
        'do not propose next steps or ask to look at code. Answer using only what the conversation shows, in one or two sentences, ' +
        'in the language of the question. If the conversation does not say, reply exactly "NOT IN CONTEXT".',
      ...(tools.length > 0 && { tools, tool_choice: { type: 'none' } }),
      messages: [...withCacheBreakpoint(history), { role: 'user', content: question }],
    })
    return firstText(response)
  }

  async function judge(probe, reply) {
    const response = await call(JUDGE_MODEL, {
      max_tokens: 2000,
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content:
            `Question: ${probe.question}\nReference fact: ${probe.fact}\nAnswer to grade: ${reply}\n\n` +
            'Does the answer state the reference fact, including its key specifics, without contradicting it? ' +
            'An answer that says the information is missing is NO. Reply with exactly YES or NO.',
        },
      ],
    })
    return /^\s*YES\b/i.test(firstText(response))
  }

  return { answer, judge }
}
