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
})
