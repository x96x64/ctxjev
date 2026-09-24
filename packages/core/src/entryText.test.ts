import { describe, expect, it } from 'vitest'
import { j } from '../test/redactCases.js'
import { toolEntryContent, toolExcerpt, truncate } from './entryText.js'
import { seededRandom } from './random.js'

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

// No lone surrogate: half of a pair is invalid text (the same check as String#isWellFormed, which
// the ES2022 lib this repo type-checks against doesn't declare).
const wellFormed = (text: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)

describe('cutting text short never splits a character', () => {
  const FAMILY = '👨‍👩‍👧‍👦' // one grapheme, 11 UTF-16 units
  const pieces = ['a', 'é', '😀', FAMILY, '🇯🇵', 'ログ', 'é', ' ', '한']

  it('truncate keeps whole emoji at any cut point', () => {
    expect(truncate('😀'.repeat(10), 6)).toBe('😀😀…')
    for (let max = 2; max < 40; max++) {
      const cut = truncate(FAMILY.repeat(5), max)
      expect(wellFormed(cut)).toBe(true)
      expect(cut.length).toBeLessThanOrEqual(max)
      expect(cut.replace('…', '').split(FAMILY).every((part) => part === '')).toBe(true)
    }
  })

  it('toolExcerpt keeps whole emoji at both of its cuts', () => {
    const text = `${'😀'.repeat(400)} middle ${'🇯🇵'.repeat(300)}`
    const cut = toolExcerpt(text, 101)
    expect(wellFormed(cut)).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(101)
    expect(cut.endsWith('🇯🇵')).toBe(true)
  })

  it('stays well-formed and within max on random mixed text', () => {
    const random = seededRandom(7)
    for (let run = 0; run < 300; run++) {
      const text = Array.from({ length: 5 + Math.floor(random() * 120) }, () => pieces[Math.floor(random() * pieces.length)]).join('')
      const max = 4 + Math.floor(random() * 60)
      for (const cut of [truncate(text, max), toolExcerpt(text, max)]) {
        expect(wellFormed(cut), JSON.stringify({ text, max })).toBe(true)
        expect(cut.length).toBeLessThanOrEqual(max)
      }
    }
  })
})
