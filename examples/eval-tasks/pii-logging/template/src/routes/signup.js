import { auditRecord } from '../audit/trail.js'

export async function signup(req, { users, audit }) {
  const user = await users.create({ email: req.body.email, phone: req.body.phone, name: req.body.name })
  await audit.write(auditRecord('signup', user))
  return { status: 201, body: { id: user.id } }
}
