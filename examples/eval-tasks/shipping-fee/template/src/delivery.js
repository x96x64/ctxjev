import { REGIONS } from './regions.js'

// 出荷日から数えたお届け予定日（YYYY-MM-DD）。
export function estimatedDelivery(prefecture, shippedOn) {
  const days = REGIONS[prefecture]?.days ?? 3
  const date = new Date(`${shippedOn}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
