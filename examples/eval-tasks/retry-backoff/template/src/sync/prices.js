import { request } from '../http/client.js'

export async function syncPrices(api, db) {
  const prices = await request(() => api.get('/v2/prices'))
  for (const p of prices) await db.upsertPrice(p.sku, p.cents)
  return prices.length
}
