// Transactional email. Dedupes with db.markSeen so a retried job never double-sends.
export async function sendReceipt(db, mailer, { orderId, to }) {
  const key = `receipt:${orderId}`
  if (await db.hasSeen(key)) return false
  await mailer.send({ to, template: 'receipt', orderId })
  await db.markSeen(key, 7 * 24 * 60 * 60 * 1000)
  return true
}
