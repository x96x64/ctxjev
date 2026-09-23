// Parses "10MB", "512KB", "2GB" into bytes.
const UNITS = { B: 1, KB: 1000, MB: 1000 * 1000, GB: 1000 * 1000 * 1000 }

export function parseSize(text) {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i.exec(text.trim())
  if (!match) throw new Error(`bad size: ${text}`)
  return Math.round(Number(match[1]) * UNITS[match[2].toUpperCase()])
}
