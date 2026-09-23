import { describe, expect, it } from 'vitest'
import { buildJevRequest } from './jevClient.js'
import type { Entry } from './types.js'

describe('buildJevRequest', () => {
  const entries: Entry[] = [
    { id: 'e1', role: 'tool', toolName: 'Bash', content: 'export TYPESAFE_API_KEY=abc123def456ghi', timestamp: 0 },
    { id: 'weird"id', role: 'user', content: 'plain text', timestamp: 1 },
  ]

  it('masks secrets in entry content and goal before anything is sent', () => {
    const { state } = buildJevRequest('rotate the key sk-abcdefghijklmnopqrstuvwxyz', entries)
    expect(state.goal).toBe('rotate the key [REDACTED]')
    expect(state.entries.e1.content).toBe('export TYPESAFE_API_KEY=[REDACTED]')
  })

  it('asks one question per entry, keyed by entry id', () => {
    const { questions } = buildJevRequest('goal', entries)
    expect(Object.keys(questions)).toEqual(['e1', 'weird"id'])
  })

  it('shares the batch-wide latest activity with the chunk, masked and shortened', () => {
    const latest: Entry[] = [{ id: 'z', role: 'tool', toolName: 'Bash', content: `npm test: all passed ${'x'.repeat(500)}`, timestamp: 9 }]
    const { state } = buildJevRequest('goal', entries, latest)
    expect(state.latest).toHaveLength(1)
    expect(state.latest![0].content.length).toBeLessThanOrEqual(200)
    expect(state.latest![0].content.startsWith('npm test: all passed')).toBe(true)
  })

  it('omits latest entirely when none is given', () => {
    expect('latest' in buildJevRequest('goal', entries).state).toBe(false)
  })
})
