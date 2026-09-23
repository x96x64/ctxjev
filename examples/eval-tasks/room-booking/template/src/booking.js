const OPEN = '08:00'
const CLOSE = '22:00'

// reservation: { room: 'A', start: '09:00', end: '10:30' }（その日の時刻）
// 返り値: { ok: true } または { ok: false, code: 'INVALID_RANGE' | 'OUT_OF_HOURS' | 'OVERLAP' }
export function canBook(existing, request) {
  if (request.start >= request.end) return { ok: false, code: 'INVALID_RANGE' }
  if (request.start < OPEN || request.end > CLOSE) return { ok: false, code: 'OUT_OF_HOURS' }
  for (const r of existing) {
    if (r.room !== request.room) continue
    if (request.start < r.end && r.start < request.end) return { ok: false, code: 'OVERLAP' }
  }
  return { ok: true }
}
