import { describe, expect, it, vi } from 'vitest'
import { pruneMessages } from './anthropicMessages.js'
import type { ScoreCache } from './cache.js'
import { buildJevRequest, scoreRelevance, type JevClient } from './jevClient.js'
import { pruneContext, scoreEntries } from './prune.js'
import type { Entry } from './types.js'
import { AUDIT3_LINES } from '../test/redactCases.js'

describe('buildJevRequest', () => {
  const entries: Entry[] = [
    { id: 'e1', role: 'tool', toolName: 'Bash', content: 'export TYPESAFE_API_KEY=abc123def456ghi', timestamp: 0 },
    { id: 'weird"id', role: 'user', content: 'plain text', timestamp: 1 },
  ]

  it('masks secrets in entry content and goal before anything is sent', () => {
    const { state } = buildJevRequest('rotate the key sk-abcdefghijklmnopqrstuvwxyz', entries)
    expect(state.goal).toBe('rotate the key [REDACTED]')
    expect(state.entries.e0.content).toBe('export TYPESAFE_API_KEY=[REDACTED]')
  })

  it('asks one question per entry, named e0, e1, … in order rather than by entry id', () => {
    const { state, questions, questionIds } = buildJevRequest('goal', entries)
    expect(questionIds).toEqual(['e0', 'e1'])
    expect(Object.keys(questions)).toEqual(['e0', 'e1'])
    expect(Object.keys(state.entries)).toEqual(['e0', 'e1'])
    expect(state.entries.e1.content).toBe('plain text')
  })

  // The audit put a GitHub token in an entry's toolName and id and found both in the request body.
  it('sends neither an entry id nor an unmasked tool name', () => {
    const token = ['ghp', '_', 'A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5'].join('')
    const leaky: Entry[] = [{ id: `toolu_${token}`, role: 'tool', toolName: token, content: 'ran it', timestamp: 0 }]
    const latest: Entry[] = [{ id: `later_${token}`, role: 'tool', toolName: `mcp__${token}`, content: 'ran it again', timestamp: 1 }]
    const request = buildJevRequest('goal', leaky, latest)
    const sent = JSON.stringify({ state: request.state, questions: request.questions })
    expect(sent).not.toContain(token)
    expect(sent).not.toContain('toolu_')
    expect(request.state.entries.e0.toolName).toBe('[REDACTED]')
  })

  it('shares the batch-wide latest activity with the chunk, masked and shortened', () => {
    const latest: Entry[] = [{ id: 'z', role: 'tool', toolName: 'Bash', content: `npm test: all passed ${'x'.repeat(500)}`, timestamp: 9 }]
    const { state } = buildJevRequest('goal', entries, latest)
    expect(state.latest).toHaveLength(1)
    expect(state.latest![0].content.length).toBeLessThanOrEqual(200)
    expect(state.latest![0].content.startsWith('npm test: all passed')).toBe(true)
  })

  // The third audit found each of these sent as-is: a label before the credential hid it.
  it('masks the third audit\'s lines in the goal, every entry, and the latest activity', () => {
    const leaky: Entry[] = AUDIT3_LINES.map(({ text }, i) => ({ id: `x${i}`, role: 'tool', toolName: 'Bash', content: `out: ${text}`, timestamp: i }))
    const request = buildJevRequest(`fix it; ${AUDIT3_LINES[1].text}`, leaky, leaky)
    const sent = JSON.stringify({ state: request.state, questions: request.questions })
    for (const { secret } of AUDIT3_LINES) expect(sent).not.toContain(secret)
  })

  it('omits latest entirely when none is given', () => {
    expect('latest' in buildJevRequest('goal', entries).state).toBe(false)
  })
})

/**
 * A stand-in for TypeSafeClient that answers every question it's asked with a relevance chosen by
 * the entry's content (the request names entries e0, e1, …, never by id), and records each request.
 * Lets the Jev path — caching, usage, a missing answer — run without a key.
 */
function fakeJev(relevanceFor: (content: string) => number | undefined = () => 0.5, usagePerEntry = 10) {
  const requests: Array<{ state: { goal: string; entries: Record<string, { content: string }>; latest?: unknown[] }; questions: Record<string, unknown> }> = []
  const client = {
    systemOne: vi.fn(async (request: (typeof requests)[number]) => {
      requests.push(request)
      const ids = Object.keys(request.questions)
      const answers = Object.fromEntries(
        ids.flatMap((id) => {
          const relevance = relevanceFor(request.state.entries[id].content)
          return relevance === undefined ? [] : [[id, { noul: relevance }]]
        }),
      )
      return { answers, usage: { input_tokens: ids.length * usagePerEntry, output_tokens: ids.length } }
    }),
  }
  return { client: client as unknown as JevClient, requests, systemOne: client.systemOne }
}

const sentContents = (request: { state: { entries: Record<string, { content: string }> } }) => Object.values(request.state.entries).map((e) => e.content)

const memoryCache = (): ScoreCache & { store: Map<string, number> } => {
  const store = new Map<string, number>()
  return { store, get: (k) => store.get(k), set: (k, v) => void store.set(k, v) }
}

const twoEntries: Entry[] = [
  { id: 'a', role: 'tool', toolName: 'Grep', content: 'chargeCustomer() called twice on retry', timestamp: 0 },
  { id: 'b', role: 'tool', toolName: 'Bash', content: 'ls public/audio', timestamp: 1 },
]

describe('scoreRelevance with an injected client (offline)', () => {
  it('asks once for every uncached entry, caches the answers, and reports usage', async () => {
    const jev = fakeJev((content) => (content.startsWith('chargeCustomer') ? 0.9 : 0.1))
    const cache = memoryCache()
    const { verdicts, usage } = await scoreRelevance('fix the double charge', twoEntries, cache, [], jev.client)
    expect(verdicts).toEqual([
      { entryId: 'a', relevance: 0.9 },
      { entryId: 'b', relevance: 0.1 },
    ])
    expect(jev.systemOne).toHaveBeenCalledTimes(1)
    expect(Object.keys(jev.requests[0].questions)).toEqual(['e0', 'e1'])
    expect(sentContents(jev.requests[0])).toEqual(twoEntries.map((e) => e.content))
    expect(usage).toEqual({ inputTokens: 20, outputTokens: 2 })
    expect(cache.store.size).toBe(2)
  })

  it('sends nothing on a full cache hit, keyed by content rather than id', async () => {
    const jev = fakeJev()
    const cache = memoryCache()
    await scoreRelevance('goal', twoEntries, cache, [], jev.client)
    const renamed = twoEntries.map((e) => ({ ...e, id: `${e.id}-again` }))
    const { verdicts, usage } = await scoreRelevance('goal', renamed, cache, [], jev.client)
    expect(jev.systemOne).toHaveBeenCalledTimes(1)
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(verdicts.map((v) => v.relevance)).toEqual([0.5, 0.5])
  })

  it('asks only about the entries the cache misses', async () => {
    const jev = fakeJev()
    const cache = memoryCache()
    await scoreRelevance('goal', twoEntries.slice(0, 1), cache, [], jev.client)
    await scoreRelevance('goal', twoEntries, cache, [], jev.client)
    expect(sentContents(jev.requests[1])).toEqual(['ls public/audio'])
  })

  it('misses the cache when the latest activity changed, since that can change the verdict', async () => {
    const jev = fakeJev()
    const cache = memoryCache()
    await scoreRelevance('goal', twoEntries, cache, [], jev.client)
    await scoreRelevance('goal', twoEntries, cache, [{ id: 'z', role: 'tool', content: 'npm test: all passed', timestamp: 9 }], jev.client)
    expect(jev.systemOne).toHaveBeenCalledTimes(2)
  })

  it('fails loudly when an answer is missing, rather than guessing a relevance', async () => {
    const jev = fakeJev((content) => (content === 'ls public/audio' ? undefined : 0.5))
    await expect(scoreRelevance('goal', twoEntries, undefined, [], jev.client)).rejects.toThrow('Jev returned no answer for entry "b"')
  })

  it('never calls Jev for an empty batch', async () => {
    const jev = fakeJev()
    expect(await scoreRelevance('goal', [], undefined, [], jev.client)).toEqual({ verdicts: [], usage: { inputTokens: 0, outputTokens: 0 } })
    expect(jev.systemOne).not.toHaveBeenCalled()
  })
})

describe("scoreEntries with scorer: 'jev' and an injected client (offline)", () => {
  const many: Entry[] = Array.from({ length: 120 }, (_, i) => ({ id: `e${i}`, role: 'tool', content: `entry ${i}`, timestamp: i }))

  it('sends one request per chunk of 50, each with the batch-wide latest activity, and totals usage per request', async () => {
    const jev = fakeJev()
    const usages: number[] = []
    const scored = await scoreEntries(many, 'goal with sk-ant-api03-abcdefghijklmnopqrstuv', 0, { scorer: 'jev', jevClient: jev.client, onUsage: (u) => usages.push(u.inputTokens) })
    expect(scored).toHaveLength(120)
    expect(jev.requests.map((r) => Object.keys(r.questions).length).sort()).toEqual([20, 50, 50])
    expect(usages.sort((x, y) => x - y)).toEqual([200, 500, 500])
    for (const request of jev.requests) {
      expect(request.state.latest).toHaveLength(8)
      expect(request.state.goal).toBe('goal with [REDACTED]')
    }
  })
})

describe('the default scorer', () => {
  // The preregistered holdout comparison made 'recency' the default in 0.6.0 (see prune.ts). This
  // pins it: no scorer option means ranking by position, and never a Jev request.
  it('is recency: ranks by position and never touches Jev', async () => {
    const jev = fakeJev()
    const entries: Entry[] = [
      { id: 'old', role: 'tool', content: 'the fix', timestamp: 1 },
      { id: 'mid', role: 'tool', content: 'unrelated', timestamp: 2 },
      { id: 'new', role: 'user', content: 'latest', timestamp: 3 },
    ]
    const scored = await scoreEntries(entries, 'goal', 0, { jevClient: jev.client })
    expect(scored.map((s) => s.relevance)).toEqual([0, 0.5, 1])
    const decisions = await pruneContext(entries, 'goal', undefined, { jevClient: jev.client })
    expect(decisions.map((d) => d.action)).toEqual(['drop', 'summarize', 'keep'])
    const { decisions: messageDecisions } = await pruneMessages([{ role: 'user', content: 'task' }, { role: 'assistant', content: 'ok' }], 'goal', { jevClient: jev.client })
    expect(messageDecisions).toHaveLength(2)
    expect(jev.systemOne).not.toHaveBeenCalled()
  })
})
