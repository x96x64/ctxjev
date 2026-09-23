import { readFileSync } from 'node:fs'

const raw = JSON.parse(readFileSync(new URL('../config/limits.json', import.meta.url), 'utf8'))

export const limits = { limit: raw.default.requests, windowMs: raw.default.windowSeconds * 1000 }
