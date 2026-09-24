import { describe, expect, it } from 'vitest'
import { jsonErrorOffset } from './jsonError.js'

describe('jsonErrorOffset', () => {
  it('is undefined for valid JSON of any shape', () => {
    for (const text of ['{}', '[]', '"x"', '-1.5e3', 'true', ' null ', '{"a": [1, {"b": "c\\"d"}], "e": false}', JSON.stringify({ goal: 'x', entries: [{ id: 'a', n: [1, 2, { z: null }] }] }, null, 2)]) {
      expect(jsonErrorOffset(text), text).toBeUndefined()
    }
  })

  it('points at the first character that breaks it', () => {
    expect(jsonErrorOffset('[1,,2]')).toBe(3)
    expect(jsonErrorOffset('{"a" 1}')).toBe(5)
    expect(jsonErrorOffset('{"a": 1,}')).toBe(8)
    expect(jsonErrorOffset('{"a": tru}')).toBe(6)
    expect(jsonErrorOffset('{"a": 1} x')).toBe(9)
  })

  it('points past the end when the text is cut off', () => {
    expect(jsonErrorOffset('{"a": [1, 2')).toBe(11)
    expect(jsonErrorOffset('{"a": "unterminated')).toBe(19)
  })

  it('agrees with JSON.parse on random inputs', () => {
    const pieces = ['{', '}', '[', ']', ',', ':', '"k"', '1', 'true', ' ', '"', 'x']
    let seed = 3
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let run = 0; run < 3000; run++) {
      const text = Array.from({ length: 1 + Math.floor(random() * 10) }, () => pieces[Math.floor(random() * pieces.length)]).join('')
      let valid = true
      try {
        JSON.parse(text)
      } catch {
        valid = false
      }
      expect(jsonErrorOffset(text) === undefined, text).toBe(valid)
    }
  })

  it('handles deep nesting without overflowing the stack', () => {
    expect(jsonErrorOffset('['.repeat(200_000))).toBe(200_000)
  })
})
