const OPEN = 8 * 60
const CLOSE = 22 * 60
// 清掃のため、同じ部屋の予約の前後に空ける時間（分）。
const CLEANING_MINUTES = 15

// '9:30' も '09:30' も分に直す。文字列のまま比べると '9:30' > '10:00' になる。
function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// reservation: { room: 'A', start: '09:00', end: '10:30' }（その日の時刻）
// 返り値: { ok: true } または { ok: false, code: 'INVALID_RANGE' | 'OUT_OF_HOURS' | 'OVERLAP' }
export function canBook(existing, request) {
  const start = toMinutes(request.start)
  const end = toMinutes(request.end)
  if (start >= end) return { ok: false, code: 'INVALID_RANGE' }
  if (start < OPEN || end > CLOSE) return { ok: false, code: 'OUT_OF_HOURS' }
  for (const r of existing) {
    if (r.room !== request.room) continue
    if (start < toMinutes(r.end) + CLEANING_MINUTES && toMinutes(r.start) < end + CLEANING_MINUTES) return { ok: false, code: 'OVERLAP' }
  }
  return { ok: true }
}
