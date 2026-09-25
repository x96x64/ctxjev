#!/usr/bin/env node
/**
 * Release check, run by publish.yml before anything is published:
 *
 * - The 7 version-lockstep files (see CHANGELOG.md) agree on one version. They drifted silently for
 *   five releases (0.1.3-0.1.7) before anyone noticed.
 * - Every `ctxjev-mcp@<version>` pin in the MCP setup examples and configs names that same version.
 *   They're pinned so a host never runs whatever version npm happens to have; the cost is that each
 *   release has to move them, and this is what makes sure it does.
 *
 * Usage (from the repo root):
 *   node scripts/check-versions.mjs                 check; exits 1 on any mismatch
 *   node scripts/check-versions.mjs --update-pins   first rewrite every pin to the lockstep version
 *                                                   (part of the release commit; see CONTRIBUTING.md)
 */
import { readFileSync, writeFileSync } from 'node:fs'

const LOCKSTEP = [
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/mcp-server/package.json',
  'packages/claude-plugin/package.json',
  '.claude-plugin/marketplace.json',
  'packages/claude-plugin/.claude-plugin/plugin.json',
  'plugins/ctxjev/plugin.json',
]
const PINNED = ['packages/mcp-server/README.md', 'plugins/ctxjev/mcp.json']

const problems = []
const versions = LOCKSTEP.map((file) => [file, JSON.parse(readFileSync(file, 'utf8')).version])
const version = versions[0][1]
if (new Set(versions.map(([, v]) => v)).size > 1) {
  problems.push('Version lockstep violated:', ...versions.map(([file, v]) => `  ${v}  ${file}`))
}

for (const file of PINNED) {
  if (process.argv.includes('--update-pins')) {
    writeFileSync(file, readFileSync(file, 'utf8').replace(/ctxjev-mcp@[0-9A-Za-z.+-]+/g, `ctxjev-mcp@${version}`))
  }
  const text = readFileSync(file, 'utf8')
  const pins = [...text.matchAll(/ctxjev-mcp@([0-9A-Za-z.+-]+)/g)].map((m) => m[1])
  const unpinned = [...text.matchAll(/(?:npx|"args": \[)\s*"?ctxjev-mcp(?!@)\b/g)].length
  if (pins.length === 0) problems.push(`${file}: no ctxjev-mcp@<version> pin found`)
  if (unpinned > 0) problems.push(`${file}: ${unpinned} unpinned ctxjev-mcp reference(s) — pin them to ctxjev-mcp@${version}`)
  for (const pin of pins) if (pin !== version) problems.push(`${file}: pins ctxjev-mcp@${pin}, but this release is ${version} — update the pin`)
}

if (problems.length > 0) {
  for (const p of problems) console.error(p)
  process.exit(1)
}
console.log(`All ${LOCKSTEP.length} lockstep files agree on ${version}, and every ctxjev-mcp pin names it.`)
