import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from './logger.js'

const CONFIG_DIR = new URL('../config/', import.meta.url).pathname

function readJson(name) {
  const path = join(CONFIG_DIR, name)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
}

function merge(base, override) {
  const out = { ...base }
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v
  }
  return out
}

const ENV_OVERRIDES = {
  PORT: ['port'],
  DB_HOST: ['db', 'host'],
  SHOPAPI_POOL_MAX: ['db', 'poolMax'],
  CACHE_TTL_SECONDS: ['cache', 'ttlSeconds'],
  LOG_LEVEL: ['logLevel'],
}
const DEPRECATED_ALIASES = { POOL_MAX: 'SHOPAPI_POOL_MAX' }
const warned = new Set()

export function loadConfig(env = process.env) {
  const resolved = { ...env }
  for (const [alias, canonical] of Object.entries(DEPRECATED_ALIASES)) {
    if (env[alias] === undefined) continue
    if (!warned.has(alias)) {
      warned.add(alias)
      logger.warn(`${alias} is deprecated, use ${canonical}`)
    }
    if (resolved[canonical] === undefined) resolved[canonical] = env[alias]
  }
  let config = merge(readJson('default.json'), readJson(`${env.NODE_ENV ?? 'development'}.json`))
  for (const [name, path] of Object.entries(ENV_OVERRIDES)) {
    if (resolved[name] === undefined) continue
    let target = config
    for (const key of path.slice(0, -1)) target = target[key]
    const last = path[path.length - 1]
    target[last] = typeof target[last] === 'number' ? Number.parseInt(resolved[name], 10) : resolved[name]
  }
  return config
}
