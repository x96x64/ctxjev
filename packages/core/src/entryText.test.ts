import { describe, expect, it } from 'vitest'
import { j } from '../test/redactCases.js'
import { toolEntryContent } from './entryText.js'

describe('toolEntryContent', () => {
  // The audit found a tool input cut at 160 characters before masking, which left the first 16
  // characters of a GitHub token in what's sent to Jev.
  it('masks a tool input before cutting it short, so no part of a secret survives the cut', () => {
    const token = j('ghp', '_', 'A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S7t8')
    // The token starts at character 144, so a 160-character cut keeps its first 15 characters.
    const content = toolEntryContent('Bash', { command: `${'x'.repeat(143)} ${token} more` }, { text: 'ok' })
    expect(content).not.toContain('ghp_A1b2')
    expect(content).toContain('[REDACTED]')
  })

  it('masks a tool input with no known key field before cutting its JSON short', () => {
    // {"padding":"yyy…","apiKey":"sk-…": the key's value starts at character 154, just before the cut.
    const content = toolEntryContent('Custom', { padding: 'y'.repeat(130), apiKey: j('sk', '-', 'abcdefghijklmnopqrstuvwxyz0123') }, { text: 'ok' })
    expect(content).not.toMatch(/sk-abc/)
    expect(content).toContain('"apiKey":"[REDA') // the mask itself is what got cut
  })
})
