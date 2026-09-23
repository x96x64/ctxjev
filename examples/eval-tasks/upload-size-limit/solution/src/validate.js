import { uploadConfig } from './config.js'

const MIB = 1024 * 1024
// config/upload.json's "10MB" is what the apps call 10 MB: 10 MiB. PDFs get a larger limit.
const DEFAULT_LIMIT_MIB = Number.parseFloat(uploadConfig.maxSize)
const LIMIT_MIB_BY_TYPE = { 'application/pdf': 25 }

// file: { name, type, size (bytes) }
export function validateUpload(file) {
  if (!uploadConfig.allowedTypes.includes(file.type)) return { ok: false, status: 415, error: `Unsupported type: ${file.type}` }
  const limitMib = LIMIT_MIB_BY_TYPE[file.type] ?? DEFAULT_LIMIT_MIB
  if (file.size > limitMib * MIB) return { ok: false, status: 413, error: `File too large: max ${limitMib} MiB` }
  return { ok: true }
}
