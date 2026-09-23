import { buildIndex } from './searchIndex.js'

// クエリ側は独自に小文字化して部分一致で探す。
export function search(products, query) {
  const index = buildIndex(products)
  const q = query.toLowerCase().trim()
  if (q === '') return []
  return index.filter((entry) => entry.key.includes(q)).map((entry) => entry.id)
}
