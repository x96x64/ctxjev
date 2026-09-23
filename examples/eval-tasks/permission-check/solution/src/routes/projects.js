import { can } from '../auth/can.js'

export async function updateProject(req, { projects }) {
  const project = await projects.get(req.params.id)
  if (!can(req.user, 'update', project)) return { status: 403 }
  return { status: 200, body: await projects.update(project.id, req.body) }
}

export async function deleteProject(req, { projects }) {
  const project = await projects.get(req.params.id)
  if (!can(req.user, 'delete', project)) return { status: 403 }
  await projects.remove(project.id)
  return { status: 204 }
}

export async function archiveProject(req, { projects }) {
  const project = await projects.get(req.params.id)
  if (!can(req.user, 'archive', project)) return { status: 403 }
  await projects.archive(project.id)
  return { status: 204 }
}
