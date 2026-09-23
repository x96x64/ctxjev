import { describe, expect, it } from 'vitest'
import { messagesToEntries, pruneMessages, type AnthropicMessage } from './anthropicMessages.js'
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
    const { messages, removed } = await pruneMessages(conversation, 'Fix the checkout double charge on retry', { scorer: 'local' })

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
})
