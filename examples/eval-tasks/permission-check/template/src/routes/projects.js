import { can } from '../auth/can.js'

export async function updateProject(req, { projects }) {
  const project = await projects.get(req.params.id)
  if (!can(req.user, 'update', project)) return { status: 403 }
  return { status: 200, body: await projects.update(project.id, req.body) }
}

export async function deleteProject(req, { projects }) {
  const project = await projects.get(req.params.id)
  // TODO: 権限チェック
  await projects.remove(project.id)
  return { status: 204 }
}

export async function archiveProject(req, { projects }) {
  const project = await projects.get(req.params.id)
  if (!project.members.some((m) => m.userId === req.user.id)) return { status: 403 }
  await projects.archive(project.id)
  return { status: 204 }
}
