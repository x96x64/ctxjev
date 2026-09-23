// 権限の判定はここに集約する。ルート側で role を直接見ないこと。
const RULES = {
  read: ['admin', 'owner', 'editor', 'viewer'],
  update: ['admin', 'owner', 'editor'],
  invite: ['admin', 'owner'],
}

export function roleIn(user, project) {
  if (user.isAdmin) return 'admin'
  return project.members.find((m) => m.userId === user.id)?.role ?? null
}

export function can(user, action, project) {
  const role = roleIn(user, project)
  return Boolean(role && RULES[action]?.includes(role))
}
