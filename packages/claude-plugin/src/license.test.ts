import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The fourth audit (P1-7): the plugin ships a bundle with @typesafe-ai/sdk (and gpt-tokenizer) inside,
// but its directory, which is all a marketplace install copies, had no LICENSE and no notice for them.
const plugin = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string) => readFileSync(path, 'utf8')
// Resolved from ctxjev-core, which depends on both.
const requireFromCore = createRequire(join(plugin, '..', 'core', 'package.json'))
const licenseOf = (name: string) => read(join(dirname(requireFromCore.resolve(`${name}/package.json`)), 'LICENSE'))

describe('the plugin directory carries its licenses', () => {
  it('has a LICENSE identical to the repository\'s', () => {
    expect(read(join(plugin, 'LICENSE'))).toBe(read(join(plugin, '..', '..', 'LICENSE')))
    expect(read(join(plugin, 'LICENSE'))).toContain('Copyright © 2026 Re:COO')
  })

  it('has THIRD_PARTY_NOTICES with the full license text of every bundled dependency', () => {
    const notices = read(join(plugin, 'THIRD_PARTY_NOTICES'))
    for (const name of ['@typesafe-ai/sdk', 'gpt-tokenizer']) {
      expect(notices).toContain(`## ${name}`)
      expect(notices).toContain(licenseOf(name).trim())
    }
    expect(notices).toContain('Copyright (c) 2026 TypeSafe')
  })
})
