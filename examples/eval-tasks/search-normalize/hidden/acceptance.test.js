import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { search } from '../src/search/query.js'
import { normalize } from '../src/search/searchIndex.js'

const products = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url), 'utf8'))

test('全角英数・半角カナ・大文字小文字の違いでも見つかる', () => {
  assert.ok(search(products, 'usb').includes('p001'))
  assert.ok(search(products, 'ケーブル').includes('p002'))
  assert.ok(search(products, 'a5').includes('p004'))
  assert.ok(search(products, '350ml').includes('p006'))
  assert.ok(search(products, 'ノート').includes('p005'))
  assert.ok(search(products, 'ＵＳＢ').includes('p001'))
})

test('全角チルダ(～)は変換しないので、商品コードは入力どおりに一致する', () => {
  assert.equal(normalize('CB～0300'), 'cb～0300')
  assert.deepEqual(search(products, 'CB～0300'), ['p001'])
  assert.deepEqual(search(products, 'CB~0300'), [])
})

test('波ダッシュ(〜)もそのまま', () => {
  assert.equal(normalize('〜深煎り〜'), '〜深煎り〜')
})

test('正規化は normalize() の1か所に集約されている(query.js は独自の処理を持たない)', () => {
  const source = readFileSync(new URL('../src/search/query.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /toLowerCase|normalize\(['"]NFKC/)
  assert.match(source, /normalize/)
})
