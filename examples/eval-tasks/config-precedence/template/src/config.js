import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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

// Environment variable -> config path. Values are parsed as integers when the default is a number.
const ENV_OVERRIDES = {
  PORT: ['port'],
  DB_HOST: ['db', 'host'],
  POOL_MAX: ['db', 'poolMax'],
  CACHE_TTL_SECONDS: ['cache', 'ttlSeconds'],
  LOG_LEVEL: ['logLevel'],
}

export function loadConfig(env = process.env) {
  let config = merge(readJson('default.json'), readJson(`${env.NODE_ENV ?? 'development'}.json`))
  for (const [name, path] of Object.entries(ENV_OVERRIDES)) {
    if (env[name] === undefined) continue
    let target = config
    for (const key of path.slice(0, -1)) target = target[key]
    const last = path[path.length - 1]
    target[last] = typeof target[last] === 'number' ? Number.parseInt(env[name], 10) : env[name]
  }
  return config
}
