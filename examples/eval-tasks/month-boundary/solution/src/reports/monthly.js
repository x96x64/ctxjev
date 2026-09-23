import { toJstDate } from '../lib/date.js'

// 月次レポート: 実行時点の「今月」(日本時間)を締め月とする。
export function closingMonth({ now = () => new Date() } = {}) {
  return toJstDate(now()).slice(0, 7)
}
