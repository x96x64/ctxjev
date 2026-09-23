const latencies = new Map()

export function recordLatency(route, ms) {
  const list = latencies.get(route) ?? []
  list.push(ms)
  if (list.length > 1000) list.shift()
  latencies.set(route, list)
}

export function p95(route) {
  const list = [...(latencies.get(route) ?? [])].sort((a, b) => a - b)
  return list.length === 0 ? 0 : list[Math.floor(list.length * 0.95)]
}
