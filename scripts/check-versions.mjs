#!/usr/bin/env node
/**
 * Release check, run by publish.yml before anything is published:
 *
 * - The 7 version-lockstep files (see CHANGELOG.md) agree on one version. They drifted silently for
 *   five releases (0.1.3-0.1.7) before anyone noticed.
 * - Every `ctxjev-mcp@<version>` pin in the MCP setup examples and configs names that same version.
 *   They're pinned so a host never runs whatever version npm happens to have; the cost is that each
 *   release has to move them, and this is what makes sure it does.
 * - The Claude Code marketplace serves the plugin from that release, not from `main`: its source in
 *   .claude-plugin/marketplace.json is `git-subdir` at `ref: "v<version>"`, the tag the publish
 *   workflow creates, and `sha`, a commit whose packages/claude-plugin is exactly the one being
 *   released. A tag can be moved; a commit can't, and Claude Code checks out `sha` and verifies it
 *   when it's given (it takes precedence over `ref`). (Before 0.6.0 the source was the relative
 *   `./packages/claude-plugin`, which Claude Code reads from the default branch, so plugin users
 *   got unreleased code.)
 *
 * The pinned commit can't be the tag's own: the tag goes on the release pull request's merge
 * commit, which doesn't exist yet when the release commit is written. So `--update-pins` pins the
 * release commit itself (HEAD, once the version bump is committed; the tag's commit if the tag
 * already exists), and the check below refuses a release unless packages/claude-plugin at the
 * pinned commit is identical, tree for tree, to the commit being released (and to the tag, if it
 * exists): whatever the tag ends up on, the pinned commit ships exactly the released files.
 *
 * Usage (from the repo root):
 *   node scripts/check-versions.mjs                 check; exits 1 on any mismatch
 *   node scripts/check-versions.mjs --update-pins   first rewrite every pin, and the marketplace's
 *                                                   plugin source, to the lockstep version and
 *                                                   commit (see CONTRIBUTING.md for the order)
 */
import { execFileSync } from 'node:child_process'
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

// The plugin's marketplace entry: pinned to the release tag and to a commit with the same plugin files.
const MARKETPLACE = '.claude-plugin/marketplace.json'
const PLUGIN_PATH = 'packages/claude-plugin'
const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}
const tagCommit = git('rev-parse', '-q', '--verify', `refs/tags/v${version}^{commit}`)
const pluginTree = (commit) => git('rev-parse', `${commit}:${PLUGIN_PATH}`)

function commitToPin() {
  if (tagCommit) return tagCommit
  // Uncommitted plugin changes would be released without being in the pinned commit.
  if (git('status', '--porcelain', '--', PLUGIN_PATH)) {
    console.error(`${PLUGIN_PATH} has uncommitted changes: commit the release changes first, then run --update-pins`)
    process.exit(1)
  }
  return git('rev-parse', 'HEAD')
}

const pinnedSha = process.argv.includes('--update-pins') ? commitToPin() : undefined
const PLUGIN_SOURCE = { source: 'git-subdir', url: 'https://github.com/x96x64/ctxjev.git', path: PLUGIN_PATH, ref: `v${version}` }
{
  const marketplace = JSON.parse(readFileSync(MARKETPLACE, 'utf8'))
  const plugin = marketplace.plugins.find((p) => p.name === 'ctxjev')
  if (!plugin) problems.push(`${MARKETPLACE}: no "ctxjev" plugin entry`)
  else {
    if (process.argv.includes('--update-pins')) {
      // Only the plugin's "source" changes; the rest of the file keeps its formatting.
      const text = readFileSync(MARKETPLACE, 'utf8')
      const at = text.indexOf('"name": "ctxjev"', text.indexOf('"plugins"'))
      const source = { ...PLUGIN_SOURCE, sha: pinnedSha }
      const rest = text.slice(at).replace(/"source":\s*(?:"[^"]*"|\{[^{}]*\})/, `"source": ${JSON.stringify(source).replace(/":/g, '": ').replace(/,"/g, ', "')}`)
      writeFileSync(MARKETPLACE, text.slice(0, at) + rest)
      plugin.source = JSON.parse(readFileSync(MARKETPLACE, 'utf8')).plugins.find((p) => p.name === 'ctxjev').source
    }
    const s = plugin.source
    if (typeof s !== 'object' || s === null || Object.entries(PLUGIN_SOURCE).some(([k, v]) => s[k] !== v)) {
      problems.push(`${MARKETPLACE}: the ctxjev plugin's source is ${JSON.stringify(s)}, not ${JSON.stringify(PLUGIN_SOURCE)} plus a sha — the marketplace must serve the release tag, not main`)
    } else if (typeof s.sha !== 'string' || !/^[0-9a-f]{40}$/.test(s.sha)) {
      problems.push(`${MARKETPLACE}: the ctxjev plugin's source has no 40-character sha — run node scripts/check-versions.mjs --update-pins`)
    } else if (git('cat-file', '-t', s.sha) !== 'commit') {
      problems.push(`${MARKETPLACE}: sha ${s.sha} isn't a commit in this repository (a shallow clone? fetch the full history)`)
    } else {
      const pinned = pluginTree(s.sha)
      if (pinned !== pluginTree('HEAD')) problems.push(`${MARKETPLACE}: ${PLUGIN_PATH} at sha ${s.sha.slice(0, 12)} isn't the one being released (HEAD) — re-run --update-pins after the last plugin change`)
      if (tagCommit && pinned !== pluginTree(tagCommit)) problems.push(`${MARKETPLACE}: ${PLUGIN_PATH} at sha ${s.sha.slice(0, 12)} isn't the one tag v${version} points at`)
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p)
  process.exit(1)
}
console.log(`All ${LOCKSTEP.length} lockstep files agree on ${version}, every ctxjev-mcp pin names it, and the marketplace serves the plugin from tag v${version} and a commit with exactly the plugin files being released.`)
