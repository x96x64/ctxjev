import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findExplicitGoal, findOriginalTask, inferGoalFromEntries, parseClaudeCodeTranscript, resolveClaudeCodeGoal, transcriptStartTime } from './claudeCodeTranscript.js'
import { estimateTokens } from './tokenEstimate.js'

function record(obj: unknown): string {
  return JSON.stringify(obj)
}

describe('parseClaudeCodeTranscript', () => {
  it('extracts a plain user chat message', () => {
    const jsonl = record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the bug' } })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toEqual([{ id: 'u1', role: 'user', content: 'fix the bug', timestamp: Date.parse('2026-01-01T00:00:00.000Z') }])
  })

  it('extracts an assistant text reply', () => {
    const jsonl = record({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'found it' }] },
    })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toEqual([{ id: 'a1:text:0', role: 'assistant', content: 'found it', timestamp: Date.parse('2026-01-01T00:00:01.000Z') }])
  })

  it('combines a tool_use with its matching tool_result into one entry', () => {
    const jsonl = [
      record({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call1', name: 'Bash', input: { command: 'npm test' } }] },
      }),
      record({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: '12 passed' }] },
      }),
    ].join('\n')

    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'call1', role: 'tool', toolName: 'Bash', content: 'Bash(npm test): 12 passed' })
    // uses the tool_use's own timestamp, not the later tool_result's
    expect(entries[0].timestamp).toBe(Date.parse('2026-01-01T00:00:01.000Z'))
  })

  it('handles array-shaped tool_result content (multiple text blocks)', () => {
    const jsonl = [
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call1', name: 'Read', input: {} }] } }),
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: [{ type: 'text', text: 'line one' }] }] } }),
    ].join('\n')

    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries[0].content).toBe('Read: line one')
  })

  it('falls back to "unknown_tool" when a tool_result has no matching tool_use', () => {
    const jsonl = record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'x' }] } })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries[0].toolName).toBe('unknown_tool')
  })

  it('skips thinking blocks, non-array/non-string content, and unrelated record types', () => {
    const jsonl = [
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal reasoning' }] } }),
      record({ type: 'queue-operation', operation: 'enqueue' }),
      record({ type: 'attachment', attachment: { type: 'environment' } }),
    ].join('\n')

    expect(parseClaudeCodeTranscript(jsonl)).toEqual([])
  })

  it('skips sidechain records entirely (subagent private conversation)', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'main thread message' } }),
      record({ type: 'user', uuid: 'u2', isSidechain: true, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'subagent-internal message' } }),
      record({
        type: 'assistant',
        uuid: 'a1',
        isSidechain: true,
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'subagent-internal reply' }] },
      }),
    ].join('\n')

    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toHaveLength(1)
    expect(entries[0].content).toBe('main thread message')
  })

  it('skips malformed lines without throwing', () => {
    const jsonl = ['not json', record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'ok' } })].join('\n')
    expect(() => parseClaudeCodeTranscript(jsonl)).not.toThrow()
    expect(parseClaudeCodeTranscript(jsonl)).toHaveLength(1)
  })

  it('extracts a text block from array-shaped user content (e.g. a message with an attachment)', () => {
    const jsonl = record({
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'check this screenshot' }, { type: 'image', source: {} }] },
    })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toEqual([{ id: 'u1:text:0', role: 'user', content: 'check this screenshot', timestamp: Date.parse('2026-01-01T00:00:00.000Z') }])
  })

  it('keeps a tool_use with no matching tool_result instead of dropping it', () => {
    const jsonl = record({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call1', name: 'Bash', input: { command: 'npm test' } }] },
    })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'call1', role: 'tool', toolName: 'Bash' })
    expect(entries[0].content).toContain('no result')
  })

  it('labels a tool entry with the input that identifies the call, not just the tool name', () => {
    const jsonl = [
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'src/payments.ts' } }] } }),
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'export function charge()' }] } }),
    ].join('\n')
    expect(parseClaudeCodeTranscript(jsonl)[0].content).toBe('Read(src/payments.ts): export function charge()')
  })

  it('only keeps what came after the most recent compact_boundary record', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'old, already compacted away' } }),
      record({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-01-01T00:00:01.000Z' }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: 'still in context' } }),
    ].join('\n')
    expect(parseClaudeCodeTranscript(jsonl).map((e) => e.content)).toEqual(['still in context'])
  })

  it('treats the compaction summary message as a boundary, never as an entry or a goal', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'old task' } }),
      record({
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'This session is being continued from a previous conversation that ran out of context. Summary: ...' },
      }),
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'picking up where we left off' }] } }),
    ].join('\n')
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries.map((e) => e.content)).toEqual(['picking up where we left off'])
    expect(inferGoalFromEntries(entries)).toBeUndefined()
  })

  it('treats an isCompactSummary record as a boundary', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'old' } }),
      record({ type: 'user', uuid: 'u2', isCompactSummary: true, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'summary' } }),
    ].join('\n')
    expect(parseClaudeCodeTranscript(jsonl)).toEqual([])
  })

  it('keeps both the head and the tail of long tool output, where a summary line usually is', () => {
    const output = `running 200 tests ${'. '.repeat(600)} 198 passed, 2 failed: charge.test.ts`
    const jsonl = [
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'npm test' } }] } }),
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: output }] } }),
    ].join('\n')
    const content = parseClaudeCodeTranscript(jsonl)[0].content
    expect(content.startsWith('Bash(npm test): running 200 tests')).toBe(true)
    expect(content.endsWith('198 passed, 2 failed: charge.test.ts')).toBe(true)
    expect(content.length).toBeLessThanOrEqual(600)
  })

  it('marks a failed tool call as an error', () => {
    const jsonl = [
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'npm run build' } }] } }),
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', is_error: true, content: 'exit code 1' }] } }),
    ].join('\n')
    expect(parseClaudeCodeTranscript(jsonl)[0].content).toBe('Bash(npm run build) [error]: exit code 1')
  })

  it('masks secrets in parsed content', () => {
    const jsonl = record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'use TYPESAFE_API_KEY=abc123def456ghi please' } })
    expect(parseClaudeCodeTranscript(jsonl)[0].content).toBe('use TYPESAFE_API_KEY=[REDACTED] please')
  })

  it('counts the full tool output in sourceTokens only when asked to', () => {
    const output = 'PASS src/a.test.ts (12 tests)\n'.repeat(1500)
    const jsonl = [
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } }),
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: output }] } }),
    ].join('\n')

    expect(parseClaudeCodeTranscript(jsonl)[0].sourceTokens).toBeUndefined()
    const [counted] = parseClaudeCodeTranscript(jsonl, { countTokens: estimateTokens })
    expect(counted.content.length).toBeLessThanOrEqual(600)
    expect(counted.sourceTokens).toBeGreaterThan(10_000)
  })

  it('truncates long content to a short excerpt', () => {
    const longText = 'x'.repeat(1000)
    const jsonl = record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: longText } })
    const entries = parseClaudeCodeTranscript(jsonl)
    expect(entries[0].content.length).toBeLessThan(610)
    expect(entries[0].content.endsWith('…')).toBe(true)
  })
})

describe('transcriptStartTime', () => {
  it('returns the first timestamped record, skipping malformed and untimestamped lines', () => {
    const jsonl = ['not json', record({ type: 'queue-operation' }), record({ type: 'user', timestamp: '2026-01-01T00:00:05.000Z' })].join('\n')
    expect(transcriptStartTime(jsonl)).toBe(Date.parse('2026-01-01T00:00:05.000Z'))
  })

  it('returns undefined when nothing carries a timestamp', () => {
    expect(transcriptStartTime(record({ type: 'queue-operation' }))).toBeUndefined()
  })
})

describe('inferGoalFromEntries', () => {
  it('returns the most recent user entry', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'first' } }),
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: 'latest' } }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('latest')
  })

  it('combines the first request with the latest instruction when they differ', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'Fix the invoice totals that are off by a cent.' } }),
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Found it.' }] } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: 'Also go through the tests and summarize the plan.' } }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('Fix the invoice totals that are off by a cent.\n\nLatest instruction: Also go through the tests and summarize the plan.')
  })

    it('returns undefined when there is no user entry', () => {
    const jsonl = record({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'reply only' }] },
    })
    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBeUndefined()
  })

  it('skips a trailing bare slash command like /compact', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the checkout bug' } }),
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: '/compact' } }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('fix the checkout bug')
  })

  it('skips a wrapped skill-command invocation', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the checkout bug' } }),
      record({
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: '<command-message>ctxjev:status</command-message> <command-name>/ctxjev:status</command-name>' },
      }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('fix the checkout bug')
  })

  it('does not mistake an ordinary message that starts with "/" for a slash command', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: "/etc/hosts isn't being read correctly" } }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe("/etc/hosts isn't being read correctly")
  })

  it('does not mistake an imperative sentence starting with "/word" for a slash command', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: '/deploy the hotfix now' } }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('/deploy the hotfix now')
  })

  it('skips a short acknowledgment in favor of the last message that describes the work', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'Users are being logged out at random mid-session.' } }),
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Want me to add a grace window?' }] } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: 'yes, go ahead' } }),
    ].join('\n')
    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('Users are being logged out at random mid-session.')
  })

  it('treats a short Japanese instruction as substantive, but not a Japanese acknowledgment', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'ログイン画面のバグを直して' } }),
      record({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '猶予期間を追加しますか？' }] } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: 'はい、お願いします' } }),
    ].join('\n')
    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('ログイン画面のバグを直して')
  })

  it('falls back to a short message when nothing longer exists', () => {
    const jsonl = record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'fix the bug' } })
    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('fix the bug')
  })

  it('returns undefined when every user entry is a slash command', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: '/clear' } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: '/compact' } }),
    ].join('\n')

    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBeUndefined()
  })
})

// A synthetic log with the text Claude Code itself writes into a session: the local-command caveat,
// a command's output, an interrupt notice, bash mode, a compaction, and an expanded skill.
const noisy = readFileSync(new URL('../../../examples/sample-transcripts/claude-code-noisy-session.jsonl', import.meta.url), 'utf8')
const withoutSetGoal = noisy
  .split('\n')
  .filter((line) => !line.includes('set-goal'))
  .join('\n')

describe('Claude Code harness text', () => {
  it('never becomes an entry: meta records, command output, interrupt notices', () => {
    const contents = parseClaudeCodeTranscript(noisy).map((e) => e.content)
    expect(contents.some((c) => c.startsWith('Caveat:'))).toBe(false)
    expect(contents.some((c) => c.includes('local-command-stdout'))).toBe(false)
    expect(contents.some((c) => c.includes('Request interrupted'))).toBe(false)
    expect(contents.some((c) => c.includes('Base directory for this skill'))).toBe(false)
  })

  it('keeps bash-mode input and output as history but not as the goal', () => {
    const entries = parseClaudeCodeTranscript(withoutSetGoal)
    expect(entries.some((e) => e.content.includes('<bash-input>npm test'))).toBe(true)
    expect(inferGoalFromEntries(entries)).toBe('Use an idempotency key derived from the order id, and keep the retry count at 3.')
  })

  it('skips an interrupt notice in an array-shaped user turn', () => {
    const jsonl = [
      record({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'Fix the checkout double-charge bug.' } }),
      record({ type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
    ].join('\n')
    expect(inferGoalFromEntries(parseClaudeCodeTranscript(jsonl))).toBe('Fix the checkout double-charge bug.')
  })

  it('gives a record without a timestamp the previous one, not the start of time', () => {
    const entries = parseClaudeCodeTranscript(noisy)
    const reply = entries.find((e) => e.role === 'assistant')!
    expect(reply.timestamp).toBe(Date.parse('2026-01-01T00:00:09.000Z'))
  })
})

describe('findOriginalTask', () => {
  it('finds the first request even when a compaction has removed it from the entries', () => {
    expect(findOriginalTask(noisy)).toBe('Fix the checkout double-charge bug that happens when a payment request is retried on a slow network.')
  })

  it('never returns the compaction summary', () => {
    const jsonl = record({ type: 'user', uuid: 's', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation. Long summary follows.' } })
    expect(findOriginalTask(jsonl)).toBeUndefined()
  })
})

describe('findExplicitGoal', () => {
  it('reads the arguments of the latest /ctxjev:set-goal', () => {
    expect(findExplicitGoal(noisy)).toBe('Stop checkout from charging twice on retry; keep retries at 3')
  })

  it('reads a set-goal that Claude invoked through the Skill tool', () => {
    const jsonl = record({
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'ctxjev:set-goal', args: 'Ship the retry fix' } }] },
    })
    expect(findExplicitGoal(jsonl)).toBe('Ship the retry fix')
  })

  it('ignores set-goal with no text (that only shows the current goal)', () => {
    const jsonl = record({ type: 'user', uuid: 'c', message: { role: 'user', content: '<command-name>/ctxjev:set-goal</command-name>\n<command-args></command-args>' } })
    expect(findExplicitGoal(jsonl)).toBeUndefined()
  })
})

describe('resolveClaudeCodeGoal', () => {
  it('prefers the explicit goal', () => {
    expect(resolveClaudeCodeGoal(noisy, parseClaudeCodeTranscript(noisy))).toEqual({ goal: 'Stop checkout from charging twice on retry; keep retries at 3', source: 'explicit' })
  })

  it('otherwise combines the original task with the latest instruction since the compaction', () => {
    expect(resolveClaudeCodeGoal(withoutSetGoal, parseClaudeCodeTranscript(withoutSetGoal))).toEqual({
      goal: 'Fix the checkout double-charge bug that happens when a payment request is retried on a slow network.\n\nLatest instruction: Use an idempotency key derived from the order id, and keep the retry count at 3.',
      source: 'inferred',
    })
  })
})
