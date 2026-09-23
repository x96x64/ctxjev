import { parseSize } from './size.js'

// Storage plans as sold on the pricing page.
const PLANS = { free: '1GB', pro: '5GB', team: '50GB' }

export function quotaBytes(plan) {
  if (!(plan in PLANS)) throw new Error(`unknown plan ${plan}`)
  return parseSize(PLANS[plan])
}

export function remainingBytes(plan, usedBytes) {
  return Math.max(0, quotaBytes(plan) - usedBytes)
}
