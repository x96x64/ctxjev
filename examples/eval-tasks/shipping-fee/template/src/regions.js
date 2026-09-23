import { readFileSync } from 'node:fs'

export const REGIONS = JSON.parse(readFileSync(new URL('../config/regions.json', import.meta.url), 'utf8'))
