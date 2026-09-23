import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deleteProject, archiveProject } from '../src/routes/projects.js'
import { can } from '../src/auth/can.js'
import { admin, owner, editor, viewer, stranger, project, fakeProjects } from '../test/fixtures/users.js'

const call = async (fn, user) => {
  const projects = fakeProjects()
  const res = await fn({ params: { id: 'p1' }, user }, { projects })
  return { status: res.status, touched: projects.calls.length > 0 }
}

for (const [name, fn] of [['削除', deleteProject], ['アーカイブ', archiveProject]]) {
  test(`${name}: admin と owner だけ許可`, async () => {
    for (const user of [admin, owner]) assert.equal((await call(fn, user)).status, 204)
    for (const user of [editor, viewer, stranger]) {
      const r = await call(fn, user)
      assert.equal(r.status, 403)
      assert.equal(r.touched, false)
    }
  })
}

test('判定は can() に集約されている', () => {
  assert.equal(can(owner, 'delete', project()), true)
  assert.equal(can(editor, 'delete', project()), false)
  assert.equal(can(owner, 'archive', project()), true)
  assert.equal(can(viewer, 'archive', project()), false)
  const routes = readFileSync(new URL('../src/routes/projects.js', import.meta.url), 'utf8')
  assert.doesNotMatch(routes, /role|isAdmin|members/)
})
