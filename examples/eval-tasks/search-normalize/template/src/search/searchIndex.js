// 検索用の文字列正規化。インデックス作成時に使う。
export function normalize(text) {
  return text.toLowerCase().trim()
}

export function buildIndex(products) {
  return products.map((p) => ({ id: p.id, code: p.code, name: p.name, key: normalize(`${p.name} ${p.code}`) }))
}
