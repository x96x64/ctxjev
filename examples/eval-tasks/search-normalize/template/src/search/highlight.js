// 検索結果の表示用ハイライト(表示だけで、検索の一致判定には関わらない)
export function highlight(name, query) {
  const i = name.indexOf(query)
  return i < 0 ? name : `${name.slice(0, i)}<mark>${query}</mark>${name.slice(i + query.length)}`
}
