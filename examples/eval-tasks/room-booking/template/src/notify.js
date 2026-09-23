import { roomById } from './rooms.js'

export function confirmationMessage(reservation, userName) {
  const room = roomById(reservation.room)
  return `${userName}さん、${room?.name ?? reservation.room} を ${reservation.start}〜${reservation.end} で予約しました。`
}
