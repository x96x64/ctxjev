import { loadConfig } from '../config.js'
import { logger } from '../logger.js'

export function createPool(config = loadConfig()) {
  logger.info('db pool created', { host: config.db.host, max: config.db.poolMax })
  return { host: config.db.host, max: config.db.poolMax, idleTimeoutMs: config.db.idleTimeoutMs }
}
