import { encode } from 'gpt-tokenizer'
import { describe, expect, it } from 'vitest'
import { seededRandom } from './random.js'
import { estimateTokens } from './tokenEstimate.js'
import { describeGrowth, isLinear, measureGrowth } from '../../../test-support/linearTime.js'

// The third audit (docs/audits/2026-09-25-audit-3-ja.md, 4.1-3 and check 17): encode() is
// quadratic in the length of one pre-token, and a run of one character is one pre-token however
// long. 100,000 `x` took 8.7 s, 100,000 `█` 82.5 s, and `analyze` on a 5,000,000-character entry
// didn't finish in 120 s.
// Each check is how the time grows from n to 10n (see test-support/linearTime.ts), not a wall-clock
// limit: a 5-second one turned main's CI red under coverage (the fifth audit). Every call counts a
// run of its own length (n + call units), or varied text from its own offset: gpt-tokenizer caches
// what it encodes by pre-token, so a repeat of the same run would hide a quadratic first one (a
// number in front of the same run did: the quadratic encode passed). The piece cache works as in use.
describe('estimateTokens: time grows linearly on long runs', () => {
  const kana = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん請求書日付検証'
  const warmUp = () => estimateTokens('warm up the tokenizer: 請求書 ═══ 😀 //\n')
  const runs: Array<[string, string]> = [
    ['█', '█'],
    ['x', 'x'],
    ['=', '='],
    ['space', ' '],
    ['ab', 'ab'],
    ['─', '─'],
    ['😀', '😀'],
    // One pre-token of mixed kinds (the review of the first fix): 200,000 characters of `/\n` took
    // 20.7 seconds, and `!!` plus a combining accent 1.8 seconds at 48,000.
    ['/\\n', '/\n'],
    ['//\\n (empty comment lines)', '//\n'],
    ['!! and a combining accent', '!!\u0301'],
    ['e and a combining accent', 'e\u0301'],
  ]
  it.each(runs)('%s × 20,000 against × 200,000', async (_name, unit) => {
    const growth = await measureGrowth((n, call) => expect(estimateTokens(unit.repeat(n + call))).toBeGreaterThan(0), 20_000, { warmUp })
    expect(isLinear(growth), describeGrowth(growth)).toBe(true)
  }, 60_000)

  // Every 128-character piece of varied text is different, so none is cached: 100,000 took about
  // 0.3 s, against 67 s before. Each size is its own random text.
  it('varied kana with no punctuation, 20,000 against 200,000', async () => {
    const random = seededRandom(7)
    const variedKana = (n: number) => Array.from({ length: n }, () => kana[Math.floor(random() * kana.length)]).join('')
    const texts = new Map([20_000, 200_000].map((n) => [n, variedKana(n)]))
    const growth = await measureGrowth((n, call) => expect(estimateTokens(texts.get(n)!.slice(call % 101))).toBeGreaterThan(0), 20_000, { warmUp })
    expect(isLinear(growth), describeGrowth(growth)).toBe(true)
  }, 60_000)

  // 5,000,000 `█` also overflowed the regular expression engine's stack in the first version of the
  // fix, which matched a whole run at once: that size has to finish, however long it takes.
  it.each(['x', '█', '😀', '/\n', '!!\u0301'])('5,000,000 characters of %s: 500,000 against 5,000,000', async (unit) => {
    const text = (n: number) => unit.repeat(n / unit.length + 1).slice(0, n)
    const growth = await measureGrowth((n, call) => expect(estimateTokens(text(n + call))).toBeGreaterThan(0), 500_000, { warmUp })
    expect(isLinear(growth), describeGrowth(growth)).toBe(true)
  }, 120_000)
})

describe('estimateTokens: counts', () => {
  it('is exactly encode() for text with no run longer than 128 of one kind', () => {
    for (const text of ['', 'hello world', 'ran: npm test -- checkout.test.ts — 12 passed, 0 failed', `${'='.repeat(128)}\n${'x'.repeat(128)}`, 'パスワード：hunter2 です', '😀'.repeat(64), '/\n'.repeat(64), '!!\u0301'.repeat(42), `// ${'-'.repeat(100)}\n//\n// ${'='.repeat(100)}`]) {
      expect(estimateTokens(text)).toBe(encode(text).length)
    }
  })

  // A cut never falls between the two halves of a surrogate pair (the final review: cutting every
  // 128 code units instead turned 5,001 tokens into 5,079). encode(), the reference, is the slow
  // part here too: under coverage on a slow CI runner it passed 5 seconds (CI run 149).
  it('cuts a run of emoji between characters, not inside one', { timeout: 60_000 }, () => {
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
