// 月次レポート: 実行時点の「今月」を締め月とする。
export function closingMonth({ now = () => new Date() } = {}) {
  return now().toISOString().slice(0, 7)
}
