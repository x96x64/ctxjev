import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv } from '../src/import/parse.js'

test('ヘッダーをキーにして行を読む', () => {
  assert.deepEqual(parseCsv('商品コード,商品名,価格\nAB123456,ボールペン,120\n'), [{ 商品コード: 'AB123456', 商品名: 'ボールペン', 価格: '120' }])
})
