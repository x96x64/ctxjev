// Compliance audit trail. Legal requires the raw identifiers here; this goes to the encrypted
// audit store, never to the general log pipeline. Do not mask.
export function auditRecord(event, user) {
  return { at: new Date().toISOString(), event, userId: user.id, email: user.email, phone: user.phone }
}
