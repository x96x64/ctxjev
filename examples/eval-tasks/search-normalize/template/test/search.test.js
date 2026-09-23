import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { search } from '../src/search/query.js'

const products = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url), 'utf8'))

test('商品名の部分一致', () => {
  assert.ok(search(products, 'マグ').includes('p006'))
})

test('空のクエリは何も返さない', () => {
  assert.deepEqual(search(products, '  '), [])
})
