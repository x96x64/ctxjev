// 日付ユーティリティ。サーバーは UTC で動いているが、請求は日本時間(Asia/Tokyo)基準。

const JST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })

// Date -> 日本時間の暦日 'YYYY-MM-DD'
export function toJstDate(date) {
  return JST.format(date)
}

// 表示用: 'YYYY/MM/DD'(UTC のまま)
export function formatDate(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '/')
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000)
}
