import { buildIndex, normalize } from './searchIndex.js'

export function search(products, query) {
  const index = buildIndex(products)
  const q = normalize(query)
  if (q === '') return []
  return index.filter((entry) => entry.key.includes(q)).map((entry) => entry.id)
}
