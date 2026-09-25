import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
const skills = readdirSync(skillsDir).map((name) => ({ name, text: readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8') }))

// What a skill may run without asking, and what its body actually runs. Claude Code expands
// ${CLAUDE_PLUGIN_ROOT} in a plugin skill's allowed-tools the same way it does in the body.
const STATUS_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/dist/status.js"'

describe('skills', () => {
  // The second audit (4.6-6): `Bash(node:*)` let a model-invocable skill run any node command.
  it.each(skills)('$name may run only dist/status.js', ({ text }) => {
    const allowed = /^allowed-tools:\s*(.+)$/m.exec(text)?.[1]
    expect(allowed).toBe(`Bash(${STATUS_COMMAND} *)`)
  })

  it.each(skills)('$name runs exactly the command it is allowed to', ({ text }) => {
    const commands = [...text.matchAll(/!`([^`]+)`/g)].map((m) => m[1])
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) expect(command.startsWith(`${STATUS_COMMAND} `)).toBe(true)
  })
})
