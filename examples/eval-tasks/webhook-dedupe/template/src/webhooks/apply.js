export async function applyEvent(event, { db }) {
  switch (event.type) {
    case 'payment.captured':
      await db.appendLedger({ kind: 'capture', paymentId: event.data.paymentId, amount: event.data.amount })
      break
    case 'refund.created':
      await db.appendLedger({ kind: 'refund', paymentId: event.data.paymentId, amount: -event.data.amount })
      break
    default:
      break
  }
}
