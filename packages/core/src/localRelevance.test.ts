import { describe, expect, it } from 'vitest'
import { localRelevance } from './localRelevance.js'

describe('localRelevance', () => {
  const goal = 'Fix a bug where checkout charges customers twice on a slow network retry.'

  it('scores an entry sharing the goal’s key words above one that shares none', () => {
    const related = localRelevance(goal, 'grep "charge" in src/payments.ts — chargeCustomer() called from the retry handler')
    const unrelated = localRelevance(goal, 'ran: ls public/audio — was checking something else')
    expect(related).toBeGreaterThan(unrelated)
    expect(unrelated).toBe(0)
  })

  it('matches across camelCase identifiers and simple word forms', () => {
    expect(localRelevance('charge customers', 'chargeCustomer()')).toBe(1)
    expect(localRelevance('charges', 'charged twice')).toBe(1)
    expect(localRelevance('charging', 'charge')).toBe(1)
  })

  it('stays within [0, 1]', () => {
    const score = localRelevance(goal, goal)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  it('returns 0 for a goal with no significant words', () => {
    expect(localRelevance('and the', 'anything')).toBe(0)
  })
})

describe('localRelevance on Japanese and other non-Latin text', () => {
  const goal = '決済のリトライで顧客に二重請求されるバグを修正する'

  it('scores an entry sharing the goal’s key words above one that shares none', () => {
    const related = localRelevance(goal, 'リトライ処理の中で請求APIが二回呼ばれている')
    const unrelated = localRelevance(goal, '音声ファイルの一覧を確認した')
    expect(related).toBeGreaterThan(unrelated)
    expect(unrelated).toBe(0)
  })

  it('finds overlap for a Japanese goal whose only ASCII word appears nowhere', () => {
    const realGoal = 'じゃあ次のリリースもしたいので、他の新機能追加と修正点を厳しく粗探しして、まずplanningして'
    expect(localRelevance(realGoal, '次のリリースに向けて修正点を洗い出す')).toBeGreaterThan(0)
  })

  it('ignores particles and inflection, and keeps katakana loanwords intact', () => {
    expect(localRelevance('日本語の対応', '日本語に対応した')).toBe(1)
    expect(localRelevance('トークナイザー', 'トークナイザーを直す')).toBe(1)
  })

  it('partially matches a compound that shares only part of the goal', () => {
    const score = localRelevance('トークナイザー修正', 'トークナイザーを書き直した')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('matches English identifiers embedded in Japanese prose', () => {
    expect(localRelevance('chargeCustomerが二重に呼ばれる', 'chargeCustomer() の二重呼び出し')).toBe(1)
  })

  it('handles Korean particles and whitespace-delimited scripts like Cyrillic', () => {
    expect(localRelevance('토크나이저 수정', '토크나이저를 수정했다')).toBe(1)
    expect(localRelevance('исправить токенизатор', 'токенизатор сломан')).toBeGreaterThan(0)
  })

  it('returns 0 for a goal written only in hiragana', () => {
    expect(localRelevance('それをなおして', 'なんでも')).toBe(0)
  })
})
