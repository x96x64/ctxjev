export const ROOMS = [
  { id: 'A', name: '会議室A', capacity: 6 },
  { id: 'B', name: '会議室B', capacity: 12 },
  { id: 'C', name: '応接室', capacity: 4 },
]

export function roomById(id) {
  return ROOMS.find((room) => room.id === id)
}
