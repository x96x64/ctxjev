import { readFileSync } from 'node:fs'

export const uploadConfig = JSON.parse(readFileSync(new URL('../config/upload.json', import.meta.url), 'utf8'))
