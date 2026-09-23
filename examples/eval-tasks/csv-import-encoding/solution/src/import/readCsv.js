import { readFileSync } from 'node:fs'
import { parseCsv } from './parse.js'

// 取引先の CSV を読み込んで行の配列にする。BOM 付き UTF-8、BOM なし UTF-8、CP932 に対応。
export function readCsv(path) {
  return parseCsv(decode(readFileSync(path)))
}

function decode(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('shift_jis').decode(bytes)
  }
}
