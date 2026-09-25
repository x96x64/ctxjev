import { encode } from 'gpt-tokenizer'
import { describe, expect, it } from 'vitest'
import { seededRandom } from './random.js'
import { estimateTokens } from './tokenEstimate.js'

// The third audit (docs/audits/2026-09-25-audit-3-ja.md, 4.1-3 and check 17): encode() is
// quadratic in the length of one pre-token, and a run of one character is one pre-token however
// long. 100,000 `x` took 8.7 s, 100,000 `█` 82.5 s, and `analyze` on a 5,000,000-character entry
// didn't finish in 120 s.
describe('estimateTokens: time on long runs', () => {
  const kana = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん請求書日付検証'
  const random = seededRandom(7)
  const variedKana = Array.from({ length: 100_000 }, () => kana[Math.floor(random() * kana.length)]).join('')
  const runs: Array<[string, string]> = [
    ['█ × 100,000', '█'.repeat(100_000)],
    ['x × 100,000', 'x'.repeat(100_000)],
    ['x × 200,000', 'x'.repeat(200_000)],
    ['= × 100,000', '='.repeat(100_000)],
    ['space × 100,000', ' '.repeat(100_000)],
    ['ab × 50,000', 'ab'.repeat(50_000)],
    ['─ × 100,000', '─'.repeat(100_000)],
    ['😀 × 50,000', '😀'.repeat(50_000)],
    ['varied kana, 100,000 with no punctuation', variedKana],
  ]
  it.each(runs)('%s in under 1 second', (_name, text) => {
    const start = performance.now()
    const tokens = estimateTokens(text)
    expect(performance.now() - start).toBeLessThan(1000)
    expect(tokens).toBeGreaterThan(0)
  })

  // 5,000,000 `█` also overflowed the regular expression engine's stack in the first version of the
  // fix, which matched a whole run at once.
  it.each(['x', '█', '😀'])('5,000,000 characters of %s in under 5 seconds', (char) => {
    const start = performance.now()
    expect(estimateTokens(char.repeat(5_000_000))).toBeGreaterThan(0)
    expect(performance.now() - start).toBeLessThan(5000)
  })
})

describe('estimateTokens: counts', () => {
  it('is exactly encode() for text with no run longer than 128 of one kind', () => {
    for (const text of ['', 'hello world', 'ran: npm test -- checkout.test.ts — 12 passed, 0 failed', `${'='.repeat(128)}\n${'x'.repeat(128)}`, 'パスワード：hunter2 です', '😀'.repeat(64)]) {
      expect(estimateTokens(text)).toBe(encode(text).length)
    }
  })

  it('stays within 2% of encode() on long runs it cuts', () => {
    for (const text of ['x'.repeat(20_000), '█'.repeat(5_000), `log line\n${'='.repeat(10_000)}\nend`, 'ab'.repeat(10_000)]) {
      const exact = encode(text).length
      expect(Math.abs(estimateTokens(text) - exact)).toBeLessThanOrEqual(Math.max(2, exact * 0.02))
    }
  })
})
