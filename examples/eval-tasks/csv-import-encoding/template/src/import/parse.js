// 素朴な CSV パーサ(ダブルクォート内のカンマに対応)。1行目はヘッダー。
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = splitLine(lines[0])
  return lines.slice(1).map((line) => Object.fromEntries(splitLine(line).map((v, i) => [header[i], v])))
}

function splitLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}
