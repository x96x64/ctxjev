import { uploadConfig } from './config.js'
import { parseSize } from './size.js'

// file: { name, type, size (bytes) }
export function validateUpload(file) {
  if (!uploadConfig.allowedTypes.includes(file.type)) return { ok: false, status: 415, error: `Unsupported type: ${file.type}` }
  const max = parseSize(uploadConfig.maxSize)
  if (file.size >= max) return { ok: false, status: 413, error: `File too large (limit ${uploadConfig.maxSize})` }
  return { ok: true }
}
