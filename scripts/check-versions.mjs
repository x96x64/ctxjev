#!/usr/bin/env node
/**
 * Release check, run by publish.yml before anything is published:
 *
 * - The 7 version-lockstep files (see CHANGELOG.md) agree on one version. They drifted silently for
 *   five releases (0.1.3-0.1.7) before anyone noticed.
 * - Every `ctxjev-mcp@<version>` pin in the MCP setup examples and configs names that same version.
 *   They're pinned so a host never runs whatever version npm happens to have; the cost is that each
 *   release has to move them, and this is what makes sure it does.
 * - The Claude Code marketplace serves the plugin from that release's tag, not from `main`: its
 *   source in .claude-plugin/marketplace.json is `git-subdir` at `ref: "v<version>"`, the tag the
 *   publish workflow creates. (Before 0.6.0 it was the relative `./packages/claude-plugin`, which
 *   Claude Code reads from the default branch, so plugin users got unreleased code.)
 *
 * Usage (from the repo root):
 *   node scripts/check-versions.mjs                 check; exits 1 on any mismatch
 *   node scripts/check-versions.mjs --update-pins   first rewrite every pin, and the marketplace's
 *                                                   plugin source, to the lockstep version (part of
 *                                                   the release commit; see CONTRIBUTING.md)
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

// The plugin's marketplace entry: pinned to the release tag.
const MARKETPLACE = '.claude-plugin/marketplace.json'
const PLUGIN_SOURCE = { source: 'git-subdir', url: 'https://github.com/x96x64/ctxjev.git', path: 'packages/claude-plugin', ref: `v${version}` }
{
  const marketplace = JSON.parse(readFileSync(MARKETPLACE, 'utf8'))
  const plugin = marketplace.plugins.find((p) => p.name === 'ctxjev')
  if (!plugin) problems.push(`${MARKETPLACE}: no "ctxjev" plugin entry`)
  else {
    if (process.argv.includes('--update-pins')) {
      // Only the plugin's "source" changes; the rest of the file keeps its formatting.
      const text = readFileSync(MARKETPLACE, 'utf8')
      const at = text.indexOf('"name": "ctxjev"', text.indexOf('"plugins"'))
      const rest = text.slice(at).replace(/"source":\s*(?:"[^"]*"|\{[^{}]*\})/, `"source": ${JSON.stringify(PLUGIN_SOURCE).replace(/":/g, '": ').replace(/,"/g, ', "')}`)
      writeFileSync(MARKETPLACE, text.slice(0, at) + rest)
      plugin.source = JSON.parse(readFileSync(MARKETPLACE, 'utf8')).plugins.find((p) => p.name === 'ctxjev').source
    }
    const s = plugin.source
    if (typeof s !== 'object' || s === null || Object.entries(PLUGIN_SOURCE).some(([k, v]) => s[k] !== v)) {
      problems.push(`${MARKETPLACE}: the ctxjev plugin's source is ${JSON.stringify(s)}, not ${JSON.stringify(PLUGIN_SOURCE)} — the marketplace must serve the release tag, not main`)
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p)
  process.exit(1)
}
console.log(`All ${LOCKSTEP.length} lockstep files agree on ${version}, every ctxjev-mcp pin names it, and the marketplace serves the plugin from tag v${version}.`)
