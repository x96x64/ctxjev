import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { issueInvoices } from '../src/billing/issueInvoices.js'
import { closingMonth } from '../src/reports/monthly.js'

const at = (iso) => () => new Date(iso)

test('00:05 JST のバッチは日本時間の日付で発行する', () => {
  const out = issueInvoices([{ id: 'c1', billingDay: 1, monthlyFee: 3000 }, { id: 'c2', billingDay: 31, monthlyFee: 5000 }], { now: at('2026-03-31T15:05:00Z') })
  assert.deepEqual(out, [{ customerId: 'c1', issueDate: '2026-04-01', amount: 3000 }])
})

test('日中の実行でも従来どおり', () => {
  const out = issueInvoices([{ id: 'c1', billingDay: 10, monthlyFee: 3000 }], { now: at('2026-09-10T03:00:00Z') })
  assert.deepEqual(out, [{ customerId: 'c1', issueDate: '2026-09-10', amount: 3000 }])
})

test('月次レポートの締め月も日本時間', () => {
  assert.equal(closingMonth({ now: at('2026-04-30T15:30:00Z') }), '2026-05')
  assert.equal(closingMonth({ now: at('2026-04-30T14:30:00Z') }), '2026-04')
})

test('依存パッケージを追加していない', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.deepEqual(pkg.dependencies ?? {}, {})
  assert.equal(pkg.devDependencies, undefined)
})

test('src/lib/date.js は変更していない(既存の toJstDate を使う)', () => {
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src/lib/date.js'], { stdio: 'pipe' }))
})
