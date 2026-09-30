import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// The fourth audit (P1-4, check 25): check-sessions.mjs checked 0 sessions and passed, protecting
// nothing, since only format-2 tasks were checked and none has a session yet.
const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'check-sessions.mjs')
const sessions = join(here, '../../../examples/eval-sessions')
const run = (args = []) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

let dir
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

describe('check-sessions.mjs', () => {
  it('checks the repository\'s Japanese sessions, and passes', () => {
    const result = run()
    expect(result.status, result.stderr).toBe(0)
    const checked = Number(/check-sessions: (\d+) Japanese session/.exec(result.stdout)?.[1])
    expect(checked).toBeGreaterThan(0)
  })

  it('fails when it checks no session at all', () => {
    dir = mkdtempSync(join(tmpdir(), 'ctxjev-check-sessions-'))
    cpSync(join(sessions, 'webpack-upgrade.json'), join(dir, 'webpack-upgrade.json')) // English
    const result = run(['--sessions', dir])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no session was checked')
  })

  it('fails when a Japanese session gains an English probe', () => {
    dir = mkdtempSync(join(tmpdir(), 'ctxjev-check-sessions-'))
    const session = JSON.parse(readFileSync(join(sessions, 'stale-price.json'), 'utf8'))
    session.probes.push({ question: 'Which file sets the price?', fact: 'price.ts' })
    writeFileSync(join(dir, 'stale-price.json'), JSON.stringify(session))
    const result = run(['--sessions', dir])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("isn't in Japanese")
  })
})
