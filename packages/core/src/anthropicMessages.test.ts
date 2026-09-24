import { describe, expect, it } from 'vitest'
import { messagesToEntries, pruneMessages, type AnthropicContentBlock, type AnthropicMessage, type PruneMessagesOptions } from './anthropicMessages.js'
import type { CustomScorer } from './prune.js'
import { estimateTokens } from './tokenEstimate.js'

// Every tool_result must follow its tool_use, and every tool_use outside the final message must
// have a result — the invariants the Messages API rejects a request for breaking.
function expectValidToolPairing(messages: AnthropicMessage[]) {
  const seenUses = new Set<string>()
  const resolved = new Set<string>()
  messages.forEach((message) => {
    if (typeof message.content === 'string') return
    for (const block of message.content) {
      if (block.type === 'tool_use') seenUses.add(block.id as string)
      if (block.type === 'tool_result') {
        expect(seenUses.has(block.tool_use_id as string), `tool_result ${block.tool_use_id} has no preceding tool_use`).toBe(true)
        resolved.add(block.tool_use_id as string)
      }
    }
  })
  const last = messages[messages.length - 1]
  const pendingInLast = new Set(Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_use').map((b) => b.id as string) : [])
  for (const id of seenUses) {
    if (!pendingInLast.has(id)) expect(resolved.has(id), `tool_use ${id} lost its tool_result`).toBe(true)
  }
  for (const message of messages) expect(message.content.length, 'no empty messages').toBeGreaterThan(0)
}

// Deterministic scores by entry id, so budget and summarize behavior can be pinned down exactly.
const scoresById = (scores: Record<string, number>): CustomScorer => async (_goal, entries) => entries.map((e) => scores[e.id] ?? 0.9)
const noRecency = { dropBelow: 0.25, summarizeBelow: 0.6, recencyWeight: 0 }
const bigLog = (label: string) => `${label}\n${'GET /static/asset.png 200 12ms\n'.repeat(300)}build finished: 3 warnings`

const withBigResults: AnthropicMessage[] = [
  { role: 'user', content: 'Fix the flaky checkout test' },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'cat a.log' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: bigLog('a.log') }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'cat b.log' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: bigLog('b.log'), is_error: true }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Both logs read. The test races the retry timer.' }] },
  { role: 'user', content: 'ok, go on' },
  { role: 'assistant', content: 'Patching the timer now.' },
]

const conversation: AnthropicMessage[] = [
  { role: 'user', content: 'Fix the checkout double charge on retry' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me look around first.' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls public' } },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'favicon.ico robots.txt' }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'charge' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'chargeCustomer() called twice on retry' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Also listing the audio folder, unrelated.' }] },
  { role: 'user', content: 'ok' },
  { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test' } }] },
]

describe('messagesToEntries', () => {
  it('makes one entry per text block and one per tool call, pairing tool_use with its tool_result', () => {
    const entries = messagesToEntries(conversation)
    expect(entries.map((e) => e.id)).toEqual(['msg:0', 'msg:1:0', 'tool:t1', 'tool:t2', 'msg:5:0', 'msg:6', 'tool:t3'])
    expect(entries.find((e) => e.id === 'tool:t2')?.content).toBe('Grep(charge): chargeCustomer() called twice on retry')
    expect(entries.find((e) => e.id === 'tool:t3')?.content).toContain('no result')
  })

  it('counts the full payload in sourceTokens, not just the excerpt in content', () => {
    const log = 'GET /static/asset.png 200 12ms\n'.repeat(2000)
    const [, tool] = messagesToEntries([
      { role: 'user', content: 'start' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'cat access.log' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'big', content: log }] },
    ])
    expect(tool.content.length).toBeLessThanOrEqual(600)
    expect(tool.sourceTokens).toBeGreaterThan(estimateTokens(tool.content) * 20)
  })

  it('orders entries by message position', () => {
    const timestamps = messagesToEntries(conversation).map((e) => e.timestamp)
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b))
  })
})

describe('pruneMessages', () => {
  it('removes dropped entries while keeping every tool_use/tool_result pair intact', async () => {
    // These entries are a few tokens each, less together than the removal note: with the note on
    // (the default), removing them would grow the conversation, so nothing is removed at all.
    const withNote = await pruneMessages(conversation, 'Fix the checkout double charge on retry', { scorer: 'local' })
    expect(withNote.messages).toBe(conversation)
    expect(withNote.savedTokens).toBe(0)

    const { messages, removed } = await pruneMessages(conversation, 'Fix the checkout double charge on retry', { scorer: 'local', marker: false })

    expect(removed.sort()).toEqual(['msg:1:0', 'msg:5:0', 'tool:t1'])
    expectValidToolPairing(messages)
    // the Grep call and its result survive; the unrelated ls call and its result are gone together
    const blocks = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    expect(blocks.some((b) => b.type === 'tool_use' && b.id === 't2')).toBe(true)
    expect(blocks.some((b) => b.type === 'tool_use' && b.id === 't1')).toBe(false)
    expect(blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 't1')).toBe(false)
  })

  it('never touches the first message or the last protectLast messages', async () => {
    const { messages } = await pruneMessages(conversation, 'something with no overlap at all', { scorer: 'local' })
    expect(messages[0]).toBe(conversation[0])
    expect(messages.slice(-2)).toEqual(conversation.slice(-2))
    expectValidToolPairing(messages)
  })

  it('keeps a tool call whose result sits inside the protected tail', async () => {
    const tail: AnthropicMessage[] = [
      { role: 'user', content: 'start the task please' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls public' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'favicon.ico' }] },
    ]
    const { messages, removed } = await pruneMessages(tail, 'unrelated goal words', { scorer: 'local', protectLast: 1 })
    expect(removed).toEqual([])
    expectValidToolPairing(messages)
  })

  it('removes a message left holding only a thinking block', async () => {
    const withThinking: AnthropicMessage[] = [
      { role: 'user', content: 'Fix the checkout double charge on retry' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm', signature: 'sig' },
          { type: 'text', text: 'Listing the audio folder, unrelated.' },
        ],
      },
      { role: 'user', content: 'continue with the checkout retry fix' },
      { role: 'assistant', content: 'Looking at the retry handler now.' },
    ]
    const { messages } = await pruneMessages(withThinking, 'Fix the checkout double charge on retry', { scorer: 'local' })
    expect(messages.map((m) => m.role)).toEqual(['user', 'user', 'assistant'])
  })

  it('reports summarize decisions but leaves those entries in place', async () => {
    const { messages, decisions } = await pruneMessages(conversation, 'Fix the checkout double charge on retry', {
      scorer: 'local',
      policy: { dropBelow: 0, summarizeBelow: 1, recencyWeight: 0.1 },
    })
    expect(decisions.every((d) => d.action === 'summarize')).toBe(true)
    expect(messages).toEqual(conversation)
  })

  describe('targetTokens', () => {
    it('removes the lowest-scoring unprotected entries until the conversation fits', async () => {
      const total = messagesToEntries(withBigResults).reduce((sum, e) => sum + (e.sourceTokens ?? 0), 0)
      const result = await pruneMessages(withBigResults, 'goal', { scorer: scoresById({ 'tool:a': 0.7, 'tool:b': 0.8 }), policy: noRecency, targetTokens: total - 100 })
      expect(result.removed).toEqual(['tool:a'])
      expect(result.overBudget).toBe(false)
      expectValidToolPairing(result.messages)
    })

    it('reports overBudget when only protected entries are left', async () => {
      const result = await pruneMessages(withBigResults, 'goal', { scorer: scoresById({}), policy: noRecency, targetTokens: 1 })
      expect(result.removed.sort()).toEqual(['msg:5:0', 'tool:a', 'tool:b'])
      expect(result.overBudget).toBe(true)
      expect(result.messages[0]).toBe(withBigResults[0])
      expectValidToolPairing(result.messages)
    })
  })

  describe('summarize', () => {
    it("'excerpt' shortens a tool result in place, keeping its tool_use and is_error", async () => {
      const result = await pruneMessages(withBigResults, 'goal', { scorer: scoresById({ 'tool:b': 0.4 }), policy: noRecency, summarize: 'excerpt' })
      expect(result.summarized).toEqual(['tool:b'])
      expect(result.removed).toEqual([])
      const block = (result.messages[4].content as AnthropicContentBlock[])[0] as { content: string; is_error: boolean }
      expect(block.content).toMatch(/^\[shortened by ctxjev from ~\d+ tokens\] b\.log/)
      expect(block.content).toContain('build finished: 3 warnings')
      expect(block.is_error).toBe(true)
      expect(result.messages[3]).toBe(withBigResults[3])
      expect(result.savedTokens).toBeGreaterThan(1000)
    })

    it('hands a custom summarizer the masked full text and skips a replacement that is no shorter', async () => {
      const seen: string[] = []
      const conversation: AnthropicMessage[] = [
        { role: 'user', content: 'start' },
        { role: 'assistant', content: [{ type: 'text', text: `export TYPESAFE_API_KEY=abc123def456ghi ${'long reasoning '.repeat(50)}` }] },
        { role: 'user', content: 'short note' },
        { role: 'assistant', content: 'end' },
        { role: 'user', content: 'go' },
      ]
      const result = await pruneMessages(conversation, 'goal', {
        scorer: async (_goal, entries) => entries.map(() => 0.4),
        policy: noRecency,
        summarize: async (_entry, text) => {
          seen.push(text)
          return text.startsWith('short') ? `${text} and then some more words` : 'a one-line summary'
        },
      })
      expect(seen.some((t) => t.includes('TYPESAFE_API_KEY=[REDACTED]'))).toBe(true)
      expect(result.summarized).toEqual(['msg:1:0'])
      expect((result.messages[1].content as AnthropicContentBlock[])[0]).toEqual({ type: 'text', text: 'a one-line summary' })
      expect(result.messages[2]).toBe(conversation[2])
    })
  })

  describe('minSavedTokens and cache impact', () => {
    it('leaves the conversation untouched when the saving is below minSavedTokens', async () => {
      const result = await pruneMessages(withBigResults, 'goal', { scorer: scoresById({ 'tool:a': 0.1 }), policy: noRecency, minSavedTokens: 1_000_000 })
      expect(result.messages).toBe(withBigResults)
      expect(result.removed).toEqual([])
      expect(result.heldBack).toBeGreaterThan(1000)
      expect(result.cache).toEqual({ firstChangedMessage: null, invalidatedTokens: 0 })
    })

    it('reports where the cache breaks and how much after it must be written again', async () => {
      const result = await pruneMessages(withBigResults, 'goal', { scorer: scoresById({ 'tool:b': 0.1 }), policy: noRecency })
      expect(result.removed).toEqual(['tool:b'])
      expect(result.cache.firstChangedMessage).toBe(3)
      const after = messagesToEntries(withBigResults).filter((e) => e.timestamp >= 5)
      expect(result.cache.invalidatedTokens).toBe(after.reduce((sum, e) => sum + (e.sourceTokens ?? 0), 0))
    })
  })

  describe('keepUserText and marker', () => {
    const conversation: AnthropicMessage[] = [
      { role: 'user', content: 'Fix the flaky checkout test' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'cat a.log' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: bigLog('a.log') }, { type: 'text', text: 'Keep the mark for 24 hours.' }] },
      { role: 'assistant', content: 'Understood, 24 hours.' },
      { role: 'user', content: 'Also check the retry path.' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'cat b.log' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: bigLog('b.log') }] },
      { role: 'assistant', content: 'Done looking.' },
      { role: 'user', content: 'go' },
    ]
    const lowEverything: CustomScorer = async (_goal, entries) => entries.map(() => 0.01)

    it('keeps what the user wrote while removing tool output around it', async () => {
      const result = await pruneMessages(conversation, 'goal', { scorer: lowEverything, policy: noRecency, targetTokens: 1, keepUserText: true })
      const texts = result.messages.flatMap((m) => (typeof m.content === 'string' ? [m.content] : m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text)))
      expect(texts).toContain('Keep the mark for 24 hours.')
      expect(texts).toContain('Also check the retry path.')
      expect(result.removed).toEqual(expect.arrayContaining(['tool:a', 'tool:b']))
      expect(result.removed.some((id) => id === 'msg:2:1' || id === 'msg:4')).toBe(false)
      expectValidToolPairing(result.messages)
    })

    it('with keepUserText: false, the same user text can go', async () => {
      const result = await pruneMessages(conversation, 'goal', { scorer: lowEverything, policy: noRecency, targetTokens: 1, keepUserText: false })
      expect(result.removed).toEqual(expect.arrayContaining(['msg:2:1', 'msg:4']))
    })

    it('keeps user text and adds the note by default', async () => {
      const result = await pruneMessages(conversation, 'goal', { scorer: lowEverything, policy: noRecency, targetTokens: 1 })
      expect(result.removed.some((id) => id === 'msg:2:1' || id === 'msg:4')).toBe(false)
      expect(JSON.stringify(result.messages)).toContain('[ctxjev:')
    })

    it('adds one note where history was removed, outside the protected tail', async () => {
      const result = await pruneMessages(conversation, 'goal', { scorer: scoresById({ 'tool:a': 0.01 }), policy: noRecency, marker: true })
      const notes = result.messages.flatMap((m, i) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'text' && String((b as { text: string }).text).startsWith('[ctxjev:')).map(() => i) : []))
      expect(notes).toHaveLength(1)
      expect(result.messages.slice(-2)).toEqual(conversation.slice(-2))
      expect(result.messages[0]).toBe(conversation[0])
      expectValidToolPairing(result.messages)
    })

    it('adds no note when nothing was removed', async () => {
      const result = await pruneMessages(conversation, 'goal', { scorer: scoresById({}), policy: noRecency, marker: true })
      expect(result.messages).toBe(conversation)
    })
  })

  describe('never makes a conversation larger', () => {
    // The audit's case: with the defaults (recency, marker on), one small entry is dropped and the
    // ~36-token note that replaces it is bigger, so savedTokens came out negative (-30).
    const smallDrop: AnthropicMessage[] = [
      { role: 'user', content: 'Fix the checkout bug please, it charges twice' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      { role: 'user', content: 'continue with the investigation now' },
      { role: 'assistant', content: [{ type: 'text', text: 'Looking at the retry handler code in detail now.' }] },
      { role: 'user', content: 'go on' },
      { role: 'assistant', content: 'done' },
    ]

    it('leaves it untouched when the removal note would cost more than the removal saves', async () => {
      const result = await pruneMessages(smallDrop, 'goal')
      expect(result.messages).toBe(smallDrop)
      expect(result.removed).toEqual([])
      expect(result.savedTokens).toBe(0)
      expect(result.cache.firstChangedMessage).toBeNull()
    })

    it('still makes the same removal without the note, since then it does save tokens', async () => {
      const result = await pruneMessages(smallDrop, 'goal', { marker: false })
      expect(result.removed).toEqual(['msg:1:0'])
      expect(result.savedTokens).toBeGreaterThan(0)
    })

    it('holds a change back when what it saves after the note is under minSavedTokens', async () => {
      const bigAndSmall = await pruneMessages(withBigResults, 'goal', { scorer: scoresById({ 'tool:a': 0.01 }), policy: noRecency, marker: false })
      const gross = bigAndSmall.savedTokens
      const withNote = await pruneMessages(withBigResults, 'goal', { scorer: scoresById({ 'tool:a': 0.01 }), policy: noRecency, minSavedTokens: gross })
      expect(withNote.messages).toBe(withBigResults)
      expect(withNote.heldBack).toBeGreaterThan(0)
      expect(withNote.heldBack).toBeLessThan(gross)
    })

    // Math.min(...locations) spread every removed entry's locations as call arguments: 150,000 tool
    // calls overflowed the stack (RangeError), reproduced by the audit.
    it('handles 150,000 tool calls without overflowing the stack', async () => {
      const huge: AnthropicMessage[] = [{ role: 'user', content: 'task' }]
      for (let i = 0; i < 150_000; i++) {
        huge.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: 'x' } }] })
        huge.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'ok' }] })
      }
      huge.push({ role: 'assistant', content: 'done' })
      const result = await pruneMessages(huge, 'goal', { targetTokens: 10 })
      expect(result.removed.length).toBeGreaterThan(100_000)
      expect(result.cache.firstChangedMessage).toBe(1)
      expect(result.savedTokens).toBeGreaterThan(0)
    }, 60_000)
  })

  // Seeded random conversations × random scores × every option: the result must always be a request
  // the Messages API accepts, and never touch the first message or the protected tail.
  it('keeps every invariant across randomized conversations and options', async () => {
    let seed = 42
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]
    let changedRuns = 0

    for (let run = 0; run < 150; run++) {
      const messages: AnthropicMessage[] = [{ role: 'user', content: 'the original task' }]
      let pending: string[] = []
      const turns = 2 + Math.floor(random() * 10)
      for (let t = 0; t < turns; t++) {
        const blocks: AnthropicContentBlock[] = []
        if (random() < 0.3) blocks.push({ type: 'thinking', thinking: 'hmm', signature: 's' })
        if (random() < 0.6) blocks.push({ type: 'text', text: pick(['looking', 'found it '.repeat(40), 'next step']) })
        const calls = Math.floor(random() * 3)
        for (let c = 0; c < calls; c++) {
          const id = `r${run}t${t}c${c}`
          blocks.push({ type: 'tool_use', id, name: 'Bash', input: { command: id } })
          pending.push(id)
        }
        if (blocks.every((b) => b.type === 'thinking')) blocks.push({ type: 'text', text: 'ok' })
        messages.push({ role: 'assistant', content: blocks })
        if (t === turns - 1 && random() < 0.5) break // leave the last tool calls waiting on a result
        const results: AnthropicContentBlock[] = pending.map((id) => ({ type: 'tool_result', tool_use_id: id, content: pick(['ok', bigLog(id)]) }))
        pending = []
        messages.push(random() < 0.5 || results.length === 0 ? { role: 'user', content: results.length ? [...results, { type: 'text', text: 'continue' }] : 'continue' } : { role: 'user', content: results })
      }

      const protectLast = 1 + Math.floor(random() * 3)
      const options: PruneMessagesOptions = {
        scorer: async (_goal, entries) => entries.map(() => random()),
        policy: noRecency,
        protectLast,
        ...(random() < 0.5 && { summarize: 'excerpt' as const }),
        ...(random() < 0.5 && { targetTokens: Math.floor(random() * 2000) }),
        ...(random() < 0.3 && { minSavedTokens: Math.floor(random() * 3000) }),
        ...(random() < 0.5 && { keepUserText: true }),
        ...(random() < 0.5 && { marker: true }),
      }
      const result = await pruneMessages(messages, 'goal', options)

      expectValidToolPairing(result.messages)
      expect(result.savedTokens).toBeGreaterThanOrEqual(0)
      // Measured independently of savedTokens: the scored content never grows.
      const size = (ms: AnthropicMessage[]) => messagesToEntries(ms).reduce((sum, e) => sum + (e.sourceTokens ?? 0), 0)
      expect(size(result.messages)).toBeLessThanOrEqual(size(messages))
      expect(result.messages[0]).toBe(messages[0])
      expect(result.messages.slice(-protectLast)).toEqual(messages.slice(-protectLast))
      if (result.removed.length === 0 && result.summarized.length === 0) expect(result.messages).toEqual(messages)
      else {
        changedRuns++
        expect(result.savedTokens).toBeGreaterThan(0)
        expect(size(result.messages)).toBeLessThan(size(messages))
        expect(result.cache.firstChangedMessage).toBeGreaterThan(0)
      }
    }
    // Guards the test itself: most runs must actually exercise removal or summarizing.
    expect(changedRuns).toBeGreaterThan(75)
  })
})
