import { describe, expect, it } from 'vitest'
import { messagesToEntries, pruneMessages, type AnthropicMessage } from './anthropicMessages.js'
import { pruneContext, rankLocalRelevance, scoreEntries } from './prune.js'
import { pruneEntries } from './pruneEntries.js'
import { cacheKeyFor } from './cache.js'
import { splitCjkBigrams } from './cjk.js'
import { findExplicitGoal, findOriginalTask, inferGoalFromEntries, isGoalCandidate, parseClaudeCodeTranscript, resolveClaudeCodeGoal, transcriptStartTime } from './claudeCodeTranscript.js'
import { isSubstantiveMessage, truncate } from './entryText.js'
import { localRelevance } from './localRelevance.js'
import { quoteAsData } from './quote.js'
import { redactSecrets } from './redact.js'
import { estimateTokens } from './tokenEstimate.js'
import { computeRecency } from './recency.js'
import { summarizeSavings } from './savings.js'
import type { Entry, PruneDecision, ScoredEntry } from './types.js'

// The third audit (4.1-4, checks 14-16): a string sourceTokens printed "NaN%", a text block with no
// text died with a raw TypeError, and timestamps of ±1e308 turned every recency into NaN.
const entry = (over: Record<string, unknown> = {}) => ({ id: 'a', role: 'tool', content: 'x', timestamp: 1, ...over }) as unknown as Entry

/** Fails the test on a raw TypeError/RangeError: every bad input gets a message naming the field. */
async function expectPlainError(run: () => unknown, message: RegExp) {
  let error: unknown
  try {
    await run()
  } catch (err) {
    error = err
  }
  expect(error, 'expected an error').toBeInstanceOf(Error)
  expect((error as Error).constructor).toBe(Error)
  expect((error as Error).message).toMatch(message)
}

describe('entries are checked before scoring', () => {
  it.each([
    [{ sourceTokens: '100' }, /entries\[0\]\.sourceTokens must be a non-negative number/],
    [{ sourceTokens: -1 }, /entries\[0\]\.sourceTokens/],
    [{ sourceTokens: Number.NaN }, /entries\[0\]\.sourceTokens/],
    [{ timestamp: '2026-01-01' }, /entries\[0\]\.timestamp must be a finite number/],
    [{ timestamp: Number.POSITIVE_INFINITY }, /entries\[0\]\.timestamp/],
    [{ content: null }, /entries\[0\]\.content must be a string/],
    [{ role: 'system' }, /entries\[0\]\.role must be one of user, assistant, tool/],
    [{ id: '' }, /entries\[0\]\.id must be a non-empty string/],
    [{ toolName: 3 }, /entries\[0\]\.toolName must be a string/],
  ])('%j', async (over, message) => {
    await expectPlainError(() => pruneContext([entry(over)], 'goal'), message)
    await expectPlainError(() => scoreEntries([entry(over)], 'goal'), message)
  })

  it('an entry that isn\'t an object', async () => {
    await expectPlainError(() => pruneContext([null as unknown as Entry], 'goal'), /entries\[0\] must be an object/)
    await expectPlainError(() => pruneContext('nope' as unknown as Entry[], 'goal'), /entries must be an array/)
  })

  it('summarizeSavings checks sourceTokens too, instead of adding a string', async () => {
    const bad = [entry({ sourceTokens: '100' })]
    expect(() => summarizeSavings(bad, [{ entryId: 'a', relevance: 1, recency: 1, combinedScore: 1, action: 'keep' }])).toThrow(/sourceTokens/)
  })

  it('a policy threshold or weight outside 0-1, or not a number', async () => {
    await expectPlainError(() => pruneContext([entry()], 'goal', { dropBelow: 0.3, summarizeBelow: 0.6, recencyWeight: Number.NaN }), /recencyWeight must be a number from 0 to 1/)
    await expectPlainError(() => pruneContext([entry()], 'goal', { dropBelow: 2, summarizeBelow: 0.6, recencyWeight: 0.1 }), /dropBelow must be a number from 0 to 1/)
    await expectPlainError(() => pruneContext([entry()], 'goal', { dropBelow: 0.6, summarizeBelow: 0.3, recencyWeight: 0.1 }), /dropBelow \(0.6\) must not be greater than summarizeBelow \(0.3\)/)
  })
})

describe('extreme timestamps fall back to order', () => {
  it('±1e308 gives finite recency by rank, not NaN', () => {
    const recency = computeRecency([entry({ id: 'new', timestamp: 1e308 }), entry({ id: 'old', timestamp: -1e308 }), entry({ id: 'mid', timestamp: 0 })])
    expect(recency.get('old')).toBe(0)
    expect(recency.get('mid')).toBe(0.5)
    expect(recency.get('new')).toBe(1)
  })

  it('pruneContext decides on every entry', async () => {
    const decisions = await pruneContext([entry({ id: 'x', timestamp: 1e308 }), entry({ id: 'y', timestamp: -1e308 })], 'goal', undefined, { scorer: 'local' })
    for (const d of decisions) for (const value of [d.relevance, d.recency, d.combinedScore]) expect(Number.isFinite(value)).toBe(true)
  })
})

describe('Anthropic Messages blocks are checked before reading them', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['a text block with no text', [{ role: 'user', content: [{ type: 'text' }] }], /messages\[0\]\.content\[0\]\.text must be a string/],
    ['a text block whose text is a number', [{ role: 'user', content: [{ type: 'text', text: 5 }] }], /messages\[0\]\.content\[0\]\.text must be a string/],
    ['a block that isn\'t an object', [{ role: 'user', content: [null] }], /messages\[0\]\.content\[0\] must be an object with a string "type"/],
    ['a block with no type', [{ role: 'user', content: [{ text: 'hi' }] }], /messages\[0\]\.content\[0\] must be an object with a string "type"/],
    ['a tool_use with no id', [{ role: 'user', content: 'go' }, { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] }], /messages\[1\]\.content\[0\]\.id must be a string/],
    ['a tool_use with no name', [{ role: 'user', content: 'go' }, { role: 'assistant', content: [{ type: 'tool_use', id: 't', input: {} }] }], /messages\[1\]\.content\[0\]\.name must be a string/],
    ['a tool_result with no tool_use_id', [{ role: 'user', content: [{ type: 'tool_result', content: 'x' }] }], /messages\[0\]\.content\[0\]\.tool_use_id must be a string/],
    ['a tool_result whose content is a number', [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 5 }] }], /messages\[0\]\.content\[0\]\.content must be a string or an array of blocks/],
    ['a tool_result block with a text block missing its text', [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text' }] }] }], /messages\[0\]\.content\[0\]\.content\[0\]\.text must be a string/],
    ['a message with no role', [{ content: 'hi' }], /messages\[0\]\.role must be "user" or "assistant"/],
    ['content that isn\'t a string or array', [{ role: 'user', content: 7 }], /messages\[0\]\.content must be a string or an array of blocks/],
    ['messages that aren\'t an array', { role: 'user' }, /messages must be an array/],
  ]
  it.each(cases)('%s', async (_name, messages, message) => {
    await expectPlainError(() => messagesToEntries(messages as AnthropicMessage[]), message)
    await expectPlainError(() => pruneMessages(messages as AnthropicMessage[], 'goal'), message)
  })
})

// Found by scripts/boundary-bruteforce.mjs: a goal that isn't a string reached the keyword scorer
// and died with "text.matchAll is not a function".
describe('the goal is checked', () => {
  it.each([undefined, null, 7, {}, []])('%j', async (goal) => {
    await expectPlainError(() => pruneContext([entry()], goal as unknown as string, undefined, { scorer: 'local' }), /goal must be a string/)
    await expectPlainError(() => pruneMessages([{ role: 'user', content: 'x' }], goal as unknown as string), /goal must be a string/)
  })
})

// The review of this change: each check below could be removed with every test still passing.
describe('options are checked', () => {
  const messages: AnthropicMessage[] = [{ role: 'user', content: 'the task' }, { role: 'assistant', content: 'done' }]
  it.each([
    [{ targetTokens: Number.NaN }, /targetTokens must be a number of at least 0, got NaN/],
    [{ targetTokens: -1 }, /targetTokens must be a number of at least 0/],
    [{ targetTokens: '10' }, /targetTokens must be a number of at least 0/],
    [{ protectLast: Number.NaN }, /protectLast must be a number of at least 0/],
    [{ protectLast: -1 }, /protectLast must be a number of at least 0/],
    [{ minSavedTokens: Number.NaN }, /minSavedTokens must be a number of at least 0/],
    [{ minSavedTokens: '5' }, /minSavedTokens must be a number of at least 0/],
    [{ summarize: 'yes' }, /summarize must be 'excerpt', a function, false, or null/],
  ])('pruneMessages %j', async (options, message) => {
    await expectPlainError(() => pruneMessages(messages, 'goal', options as never), message)
  })

  it.each([Number.NaN, -0.1, 2, '0.5'])('scoreEntries with recencyWeight %j', async (recencyWeight) => {
    await expectPlainError(() => scoreEntries([entry()], 'goal', recencyWeight as number), /recencyWeight must be a number from 0 to 1/)
  })
})

// The review of this change: pruneEntries() and rankLocalRelevance() are new exports, and read
// what they were given without checking it.
describe('pruneEntries checks what it reads', () => {
  const entries = [entry({ id: 'u', role: 'user' }), entry({ id: 'x' }), entry({ id: 'y' })]
  const decide = (es: Entry[], action: PruneDecision['action'] = 'drop'): PruneDecision[] => es.map((e) => ({ entryId: e.id, relevance: 0, recency: 0, combinedScore: 0, action }))
  it.each([
    ['entries that aren\'t an array', () => pruneEntries(null as unknown as Entry[], []), /entries must be an array/],
    ['an entry that isn\'t an object', () => pruneEntries([null as unknown as Entry], []), /entries\[0\] must be an object/],
    ['an entry with no content', () => pruneEntries([entry({ content: null })], decide([entry()])), /entries\[0\]\.content must be a string/],
    ['a string sourceTokens', () => pruneEntries([entry({ sourceTokens: '100' })], decide([entry()])), /entries\[0\]\.sourceTokens must be a non-negative number/],
    ['decisions that aren\'t an array', () => pruneEntries(entries, null as unknown as PruneDecision[]), /decisions must be an array/],
    ['a decision that isn\'t an object', () => pruneEntries(entries, [null as unknown as PruneDecision]), /decisions\[0\] must be an object/],
    ['a decision with an unknown action', () => pruneEntries(entries, decide(entries, 'delete' as PruneDecision['action'])), /decisions\[0\]\.action must be one of keep, drop, summarize/],
    ['options that aren\'t an object', () => pruneEntries(entries, decide(entries), null as never), /options must be an object/],
    ['protectFirstUserEntry that isn\'t a boolean', () => pruneEntries(entries, decide(entries), { protectFirstUserEntry: 'no' as never }), /protectFirstUserEntry must be true or false/],
    ['protectLast NaN', () => pruneEntries(entries, decide(entries), { protectLast: Number.NaN }), /protectLast must be a number of at least 0/],
    ['protectLast -1', () => pruneEntries(entries, decide(entries), { protectLast: -1 }), /protectLast must be a number of at least 0/],
    ['protectLast as a string', () => pruneEntries(entries, decide(entries), { protectLast: '2' as never }), /protectLast must be a number of at least 0/],
  ])('%s', async (_name, run, message) => {
    await expectPlainError(run, message)
  })

  // With a repeated id, the protected last entry went out with its namesake while keptDrops said it stayed.
  it('refuses a repeated entry id', async () => {
    const repeated = [entry({ id: 'u', role: 'user' }), entry({ id: 'x' }), entry({ id: 'y' }), entry({ id: 'x', content: 'LAST (protected)' })]
    await expectPlainError(() => pruneEntries(repeated, decide(repeated), { protectLast: 1 }), /duplicate entry id "x"/)
  })
})

describe('rankLocalRelevance checks what it reads', () => {
  const scored: ScoredEntry[] = [
    { entryId: 'a', relevance: 0.2, recency: 0, combinedScore: 0 },
    { entryId: 'b', relevance: 0.6, recency: 1, combinedScore: 0 },
  ]
  it.each([Number.NaN, 5, -1, '0.5'])('recencyWeight %j', async (recencyWeight) => {
    await expectPlainError(() => rankLocalRelevance(scored, recencyWeight as number), /recencyWeight must be a number from 0 to 1/)
  })

  it.each([
    ['scored entries that aren\'t an array', null, /scored must be an array/],
    ['a scored entry that isn\'t an object', [null], /scored\[0\] must be an object/],
    ['a relevance outside 0-1', [{ entryId: 'a', relevance: Number.NaN, recency: 0, combinedScore: 0 }], /scored\[0\]\.relevance must be a number from 0 to 1/],
    ['a recency outside 0-1', [{ entryId: 'a', relevance: 0.5, recency: 7, combinedScore: 0 }], /scored\[0\]\.recency must be a number from 0 to 1/],
  ])('%s', async (_name, value, message) => {
    await expectPlainError(() => rankLocalRelevance(value as ScoredEntry[]), message)
  })

  it('ranks what it was given', () => {
    for (const s of rankLocalRelevance(scored, 0.5)) expect(s.combinedScore >= 0 && s.combinedScore <= 1).toBe(true)
  })
})

// The review of this change: a null options object, or a value that can't be turned into text
// (an object with no prototype) in the message about it, gave a raw TypeError (as in 0.6.1).
describe('options and values that can\'t be printed', () => {
  const noPrototype = Object.create(null) as unknown
  const messages: AnthropicMessage[] = [{ role: 'user', content: 'the task' }, { role: 'assistant', content: 'done' }]
  it('null options', async () => {
    await expectPlainError(() => pruneContext([entry()], 'goal', undefined, null as never), /options must be an object/)
    await expectPlainError(() => scoreEntries([entry()], 'goal', undefined, null as never), /options must be an object/)
    await expectPlainError(() => pruneMessages(messages, 'goal', null as never), /options must be an object/)
    await expectPlainError(() => summarizeSavings([entry()], null as never), /decisions must be an array/)
  })

  it('a value with no prototype', async () => {
    await expectPlainError(() => pruneMessages(messages, 'goal', { targetTokens: noPrototype as number }), /targetTokens must be a number of at least 0, got \[object Object\]/)
    await expectPlainError(() => pruneMessages(messages, 'goal', { summarize: noPrototype as never }), /summarize must be 'excerpt', a function, false, or null/)
    await expectPlainError(() => pruneContext([entry()], 'goal', { dropBelow: noPrototype as number, summarizeBelow: 0.5, recencyWeight: 0.1 }), /policy\.dropBelow must be a number from 0 to 1/)
    await expectPlainError(() => scoreEntries([entry()], 'goal', noPrototype as number), /recencyWeight must be a number from 0 to 1/)
    await expectPlainError(() => pruneEntries([entry()], [{ entryId: 'a', relevance: 0, recency: 0, combinedScore: 0, action: 'keep' }], { protectLast: noPrototype as number }), /protectLast must be a number of at least 0/)
    await expectPlainError(() => pruneContext([entry(), entry({ id: 'b' })], 'goal', undefined, { scorer: async () => [noPrototype as number, 0.5] }), /custom scorer returned \[object Object\] for entry "a"/)
  })
})

// The final review of this change.
describe('what 0.6.1 accepted and still should', () => {
  const messages: AnthropicMessage[] = [
    { role: 'user', content: 'Fix the checkout retry' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { c: 'ls' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a '.repeat(300) }] },
    { role: 'assistant', content: 'done' },
  ]
  // `summarize: condition && 'excerpt'` is a common way to write it.
  it.each([false, null])('summarize: %j means no summarizing', async (summarize) => {
    const result = await pruneMessages(messages, 'checkout', { summarize: summarize as never, protectLastTurn: false, protectLast: 1 })
    expect(result.summarized).toEqual([])
  })

  it('a policy without recencyWeight uses the default one', async () => {
    const entries = [entry({ id: 'a', timestamp: 1 }), entry({ id: 'b', timestamp: 2 }), entry({ id: 'c', timestamp: 3 })]
    const partial = await pruneContext(entries, 'g', { dropBelow: 0.5, summarizeBelow: 0.6 } as never)
    expect(partial).toEqual(await pruneContext(entries, 'g', { dropBelow: 0.5, summarizeBelow: 0.6, recencyWeight: 0.1 }))
    const viaMessages = await pruneMessages(messages, 'checkout', { policy: { dropBelow: 0.5, summarizeBelow: 0.6 } as never })
    expect(viaMessages.decisions).toEqual((await pruneMessages(messages, 'checkout', { policy: { dropBelow: 0.5, summarizeBelow: 0.6, recencyWeight: 0.1 } })).decisions)
  })
})

describe('a policy that isn\'t an object', () => {
  it('null', async () => {
    await expectPlainError(() => pruneContext([entry()], 'goal', null as never), /policy must be an object/)
    await expectPlainError(() => pruneMessages([{ role: 'user', content: 'x' }], 'goal', { policy: null as never }), /policy must be an object/)
  })
})

// Two entries of 1e308 tokens added up to Infinity: "~∞ / ∞ tokens (NaN%)".
describe('sourceTokens too large to add up', () => {
  it.each([1e308, Number.MAX_SAFE_INTEGER + 2])('%d', async (sourceTokens) => {
    const big = [entry({ id: 'a', sourceTokens }), entry({ id: 'b', sourceTokens })]
    await expectPlainError(() => pruneContext(big, 'goal'), /entries\[0\]\.sourceTokens must be a non-negative number no larger than 9007199254740991/)
    await expectPlainError(() => summarizeSavings(big, []), /entries\[0\]\.sourceTokens/)
  })
})

// Every export that takes text: a value that isn't a string fails with a message, not a raw TypeError.
describe('text that isn\'t a string', () => {
  const calls: Array<[string, (value: never) => unknown]> = [
    ['estimateTokens', (v) => estimateTokens(v)],
    ['redactSecrets', (v) => redactSecrets(v)],
    ['parseClaudeCodeTranscript', (v) => parseClaudeCodeTranscript(v)],
    ['resolveClaudeCodeGoal', (v) => resolveClaudeCodeGoal(v, [])],
    ['findExplicitGoal', (v) => findExplicitGoal(v)],
    ['findOriginalTask', (v) => findOriginalTask(v)],
    ['transcriptStartTime', (v) => transcriptStartTime(v)],
    ['isGoalCandidate', (v) => isGoalCandidate(v)],
    ['isSubstantiveMessage', (v) => isSubstantiveMessage(v)],
    ['truncate', (v) => truncate(v)],
    ['quoteAsData', (v) => quoteAsData(v)],
    ['localRelevance (goal)', (v) => localRelevance(v, 'content')],
    ['localRelevance (content)', (v) => localRelevance('goal', v)],
    ['splitCjkBigrams', (v) => splitCjkBigrams(v)],
    ['cacheKeyFor (goal)', (v) => cacheKeyFor(v, { role: 'tool', content: 'x' })],
    ['cacheKeyFor (entry)', (v) => cacheKeyFor('goal', v)],
    ['inferGoalFromEntries', (v) => inferGoalFromEntries(v)],
  ]
  it.each(calls)('%s', async (_name, call) => {
    for (const value of [null, undefined, 7, {}]) await expectPlainError(() => call(value as never), /must be (a string|an object|an array)/)
  })
})
