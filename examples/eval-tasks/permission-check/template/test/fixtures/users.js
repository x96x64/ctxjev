// テスト用のユーザーとプロジェクト。新しいテストもこれを使う。
export const admin = { id: 'u-admin', isAdmin: true }
export const owner = { id: 'u-owner' }
export const editor = { id: 'u-editor' }
export const viewer = { id: 'u-viewer' }
export const stranger = { id: 'u-stranger' }

export function project() {
  return {
    id: 'p1',
    members: [
      { userId: 'u-owner', role: 'owner' },
      { userId: 'u-editor', role: 'editor' },
      { userId: 'u-viewer', role: 'viewer' },
    ],
  }
}

export function fakeProjects(p = project()) {
  const calls = []
  return {
    calls,
    get: async () => p,
    update: async (id, body) => (calls.push(['update', id]), { ...p, ...body }),
    remove: async (id) => calls.push(['remove', id]),
    archive: async (id) => calls.push(['archive', id]),
  }
}
