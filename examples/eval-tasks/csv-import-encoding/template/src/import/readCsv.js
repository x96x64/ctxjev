import { readFileSync } from 'node:fs'
import { parseCsv } from './parse.js'

// 取引先の CSV を読み込んで行の配列にする。
export function readCsv(path) {
  const text = readFileSync(path, 'utf8')
  return parseCsv(text)
}
