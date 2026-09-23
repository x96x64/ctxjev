import { request } from '../http/client.js'

export async function syncStock(api, db) {
  const levels = await request(() => api.get('/v2/stock-levels'))
  for (const l of levels) await db.upsertStock(l.sku, l.available)
  return levels.length
}
