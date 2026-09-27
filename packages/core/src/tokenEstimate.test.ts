import { encode } from 'gpt-tokenizer'
import { describe, expect, it } from 'vitest'
import { seededRandom } from './random.js'
import { estimateTokens } from './tokenEstimate.js'

// The third audit (docs/audits/2026-09-25-audit-3-ja.md, 4.1-3 and check 17): encode() is
// quadratic in the length of one pre-token, and a run of one character is one pre-token however
// long. 100,000 `x` took 8.7 s, 100,000 `█` 82.5 s, and `analyze` on a 5,000,000-character entry
// didn't finish in 120 s.
// Coverage instrumentation slows everything down; scripts/coverage.mjs scales the limits for it.
const SCALE = Number(process.env.CTXJEV_TIME_LIMIT_SCALE ?? 1)

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
    // One pre-token of mixed kinds (the review of the first fix): 200,000 characters of `/\n` took
    // 20.7 seconds, and `!!` plus a combining accent 1.8 seconds at 48,000.
    ['/\\n × 100,000', '/\n'.repeat(100_000)],
    ['//\\n × 100,000 (empty comment lines)', '//\n'.repeat(100_000)],
    ['!! and a combining accent × 66,667', '!!\u0301'.repeat(66_667)],
    ['e and a combining accent × 100,000', 'e\u0301'.repeat(100_000)],
  ]
  it.each(runs)('%s in under 1 second', (_name, text) => {
    const start = performance.now()
    const tokens = estimateTokens(text)
    expect(performance.now() - start).toBeLessThan(1000 * SCALE)
    expect(tokens).toBeGreaterThan(0)
  })

  // Every 128-character piece of varied text is different, so none is cached: about 0.3 s here,
  // against 67 s before. The same 1-second limit as the rest (scaled only under coverage).
  it('varied kana, 100,000 with no punctuation, in under 1 second', () => {
    const start = performance.now()
    expect(estimateTokens(variedKana)).toBeGreaterThan(0)
    expect(performance.now() - start).toBeLessThan(1000 * SCALE)
  })

  // 5,000,000 `█` also overflowed the regular expression engine's stack in the first version of the
  // fix, which matched a whole run at once.
  it.each(['x', '█', '😀', '/\n', '!!\u0301'])('5,000,000 characters of %s in under 5 seconds', (unit) => {
    const start = performance.now()
    expect(estimateTokens(unit.repeat(5_000_000 / unit.length + 1).slice(0, 5_000_000))).toBeGreaterThan(0)
    expect(performance.now() - start).toBeLessThan(5000 * SCALE)
  }, 60_000)
})

describe('estimateTokens: counts', () => {
  it('is exactly encode() for text with no run longer than 128 of one kind', () => {
    for (const text of ['', 'hello world', 'ran: npm test -- checkout.test.ts — 12 passed, 0 failed', `${'='.repeat(128)}\n${'x'.repeat(128)}`, 'パスワード：hunter2 です', '😀'.repeat(64), '/\n'.repeat(64), '!!\u0301'.repeat(42), `// ${'-'.repeat(100)}\n//\n// ${'='.repeat(100)}`]) {
      expect(estimateTokens(text)).toBe(encode(text).length)
    }
  })

  // A cut never falls between the two halves of a surrogate pair (the final review: cutting every
  // 128 code units instead turned 5,001 tokens into 5,079).
  it('cuts a run of emoji between characters, not inside one', () => {
    const text = `!${'😀'.repeat(5000)}`
    expect(estimateTokens(text)).toBe(encode(text).length)
  })

  // encode() itself, the reference here, is the slow part.
  it('stays within 2% of encode() on long runs it cuts', { timeout: 60_000 }, () => {
    for (const text of ['x'.repeat(20_000), '█'.repeat(5_000), `log line\n${'='.repeat(10_000)}\nend`, 'ab'.repeat(10_000)]) {
      const exact = encode(text).length
      expect(Math.abs(estimateTokens(text) - exact)).toBeLessThanOrEqual(Math.max(2, exact * 0.02))
    }
  })
})

describe('estimateTokens: special tokens', () => {
  // encode() throws on text that spells a special token unless told otherwise, and a conversation
  // about language models can quote one.
  it('counts text that spells a special token as the text it is', () => {
    for (const special of ['<|endoftext|>', '<|im_start|>', '<|im_end|>', '<|fim_prefix|>', '<|endofprompt|>']) {
      const text = `the model stops at ${special} here`
      expect(estimateTokens(text)).toBe(encode(text, { disallowedSpecial: new Set() }).length)
      expect(estimateTokens(text)).toBeGreaterThan(estimateTokens('the model stops at here'))
    }
  })
})
