import { canBook } from './booking.js'
import { confirmationMessage } from './notify.js'

// POST /reservations の処理本体。store は { list(room), add(reservation) }。
export function createReservation(store, request, userName) {
  const result = canBook(store.list(request.room), request)
  if (!result.ok) return { status: 409, body: { code: result.code } }
  store.add(request)
  return { status: 201, body: { message: confirmationMessage(request, userName) } }
}
