import { toJstDate } from '../lib/date.js'

// 請求書発行バッチ。cron: 毎日 00:05 Asia/Tokyo(= 前日 15:05 UTC)
export function issueInvoices(customers, { now = () => new Date() } = {}) {
  const issueDate = toJstDate(now())
  return customers
    .filter((c) => c.billingDay === Number(issueDate.slice(8, 10)))
    .map((c) => ({ customerId: c.id, issueDate, amount: c.monthlyFee }))
}
