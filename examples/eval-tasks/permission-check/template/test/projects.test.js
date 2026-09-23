import { test } from 'node:test'
import assert from 'node:assert/strict'
import { updateProject } from '../src/routes/projects.js'
import { editor, viewer, fakeProjects } from './fixtures/users.js'

test('editor は更新できる', async () => {
  const res = await updateProject({ params: { id: 'p1' }, user: editor, body: { name: 'x' } }, { projects: fakeProjects() })
  assert.equal(res.status, 200)
})

test('viewer は更新できない', async () => {
  const res = await updateProject({ params: { id: 'p1' }, user: viewer, body: {} }, { projects: fakeProjects() })
  assert.equal(res.status, 403)
})
