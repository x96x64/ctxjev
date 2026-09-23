// 検索用の文字列正規化。インデックスとクエリの両方がここを通る。
// NFKC で全角英数・半角カナを揃えるが、全角チルダ(～)は商品コードの区切りなので残す。
export function normalize(text) {
  return text
    .split('～')
    .map((part) => part.normalize('NFKC'))
    .join('～')
    .toLowerCase()
    .trim()
}

export function buildIndex(products) {
  return products.map((p) => ({ id: p.id, code: p.code, name: p.name, key: normalize(`${p.name} ${p.code}`) }))
}
