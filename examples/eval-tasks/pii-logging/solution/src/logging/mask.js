export function maskEmail(email) {
  const at = String(email).indexOf('@')
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`
}

export function maskPhone(phone) {
  const digits = String(phone).replace(/\D/g, '')
  return `***${digits.slice(-2)}`
}

export function maskBody(body) {
  if (!body || typeof body !== 'object') return body
  const out = { ...body }
  if ('email' in out) out.email = maskEmail(out.email)
  if ('phone' in out) out.phone = maskPhone(out.phone)
  return out
}
