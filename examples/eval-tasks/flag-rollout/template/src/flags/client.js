// Client for the internal flags service. isEnabled(flag, user) is synchronous: flag rules are
// fetched in the background and evaluated locally. Tests pass a fake with the same shape.
export function createFlags(rules = {}) {
  return {
    isEnabled(flag, user) {
      const rule = rules[flag]
      if (!rule) return false
      if (rule.users?.includes(user.id)) return true
      return typeof rule.percent === 'number' && (hash(`${flag}:${user.id}`) % 100) < rule.percent
    },
  }
}

function hash(text) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}
