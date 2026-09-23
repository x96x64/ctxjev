import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCsv } from '../src/import/readCsv.js'

const expectFirst = (rows) => {
  assert.equal(rows.length, 43)
  assert.deepEqual(Object.keys(rows[0]), ['商品コード', '商品名', '価格'])
  assert.equal(rows[0]['商品コード'], 'AB123456')
  assert.equal(rows[1]['商品名'], '「髙島屋」ギフト包装紙')
}

test('BOM 付き UTF-8: BOM を取り除いて読む', () => {
  expectFirst(readCsv('samples/partner-a-utf8bom.csv'))
})

test('CP932(Shift_JIS)の CSV も読める', () => {
  expectFirst(readCsv('samples/partner-b-cp932.csv'))
})

test('BOM なし UTF-8 も読める', () => {
  const dir = mkdtempSync(join(tmpdir(), 'csv-'))
  const path = join(dir, 'plain.csv')
  writeFileSync(path, readFileSync('samples/partner-a-utf8bom.csv').subarray(3))
  expectFirst(readCsv(path))
})

test('依存パッケージを追加していない', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.deepEqual(pkg.dependencies ?? {}, {})
  assert.equal(pkg.devDependencies, undefined)
})
