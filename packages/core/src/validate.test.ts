import { describe, expect, it } from 'vitest'
import { messagesToEntries, pruneMessages, type AnthropicMessage } from './anthropicMessages.js'
import { pruneContext, scoreEntries } from './prune.js'
import { computeRecency } from './recency.js'
import { summarizeSavings } from './savings.js'
import type { Entry } from './types.js'

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
