#!/usr/bin/env node
/**
 * Every link in the repository's Markdown resolves: a relative link to a file or directory that
 * exists, an anchor to a heading that exists, and a link to this repository on GitHub
 * (`https://github.com/x96x64/ctxjev/blob|tree/<ref>/<path>`) to a path that exists here. External
 * sites aren't fetched. The independent audit reports in docs/audits/ are kept exactly as their
 * authors wrote them, and the eval task repos and sessions under examples/ are fixtures nobody
 * edits, so both are skipped; everything else, the records we write included, is checked.
 *
 *   node scripts/check-links.mjs                 every tracked .md file
 *   node scripts/check-links.mjs FILE...         only these (a packed README, for instance), resolved
 *                                                as if they sat at their repo path given by --as
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { parseArgs } from 'node:util'
import { LINK, ROOT, REPO_URL } from './readmes.mjs'


/** GitHub's heading anchors: lowercase, punctuation dropped (letters, digits, `-`, `_` kept), spaces to `-`. */
export function slug(heading) {
  return heading
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

let trackedPaths
/** Whether git tracks `path`, a file or a directory holding tracked files. */
function tracked(path) {
  trackedPaths ??= execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
  return trackedPaths.some((f) => f === path || f.startsWith(`${path}/`))
}

function anchorsOf(text) {
  const seen = new Map()
  const anchors = new Set()
  for (const [, heading] of text.replace(/^```[\s\S]*?^```/gm, '').matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(heading)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    anchors.add(n === 0 ? base : `${base}-${n}`)
  }
  for (const [, id] of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(id)
  return anchors
}

function linksOf(text) {
  const prose = text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, 'code')
  const found = []
  const collect = (part) => {
    for (const m of part.matchAll(LINK)) {
      found.push(m[3])
      collect(m[2])
    }
  }
  collect(prose)
  for (const m of prose.matchAll(/\b(?:href|src)="([^"]+)"|^\[[^\]]+\]:\s*(\S+)/gm)) found.push(m[1] ?? m[2])
  return found
}

/** Problems with the links in `text`, a file at repo path `at`. */
export function linkProblems(text, at) {
  const problems = []
  const repoLink = new RegExp(`^${REPO_URL}/(?:blob|tree)/[^/]+/([^?#]*)(?:\\?[^#]*)?(?:#(.*))?$`)
  for (const target of linksOf(text)) {
    let path
    let anchor
    const onGitHub = repoLink.exec(target)
    if (onGitHub) [, path, anchor] = onGitHub
    else if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue
    else {
      const [file, hash] = target.split('#')
      anchor = hash
      path = file === '' ? at : posix.normalize(posix.join(posix.dirname(at), decodeURIComponent(file)))
    }
    path = path.replace(/\/$/, '')
    if (path === at) {
      // An anchor in the file itself: checked against its own headings, wherever the file sits.
      if (anchor && !anchorsOf(text).has(decodeURIComponent(anchor))) problems.push(`${at}: ${target} — no heading "#${anchor}" here`)
      continue
    }
    // Tracked by git, not just on disk: a built or ignored file (dist/, a local .env) 404s on GitHub.
    if (path.startsWith('..') || !existsSync(join(ROOT, path)) || !tracked(path)) {
      problems.push(`${at}: ${target} — ${path} doesn't exist`)
      continue
    }
    if (anchor && path.endsWith('.md') && statSync(join(ROOT, path)).isFile()) {
      const anchors = anchorsOf(readFileSync(join(ROOT, path), 'utf8'))
      if (!anchors.has(decodeURIComponent(anchor))) problems.push(`${at}: ${target} — no heading "#${anchor}" in ${path}`)
    }
  }
  return problems
}

function main() {
  const { values, positionals } = parseArgs({ options: { as: { type: 'string' } }, allowPositionals: true })
  const files =
    positionals.length > 0
      ? positionals.map((file) => [file, values.as ?? file])
      : execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: ROOT, encoding: 'utf8' })
          .split('\0')
          // The audit reports stay as their authors wrote them, and the eval task repos and sessions
          // are fixtures (never edited), not docs.
          // docs/readme-shared/ is written relative to a package directory; its copies in the package
          // READMEs are what's checked.
          .filter((f) => f && !/^docs\/audits\/.*audit-\d.*\.md$/.test(f) && !/^examples\/eval-(?:tasks|sessions)\//.test(f) && !/^docs\/readme-shared\/(?!README\.md$)/.test(f))
          .map((f) => [join(ROOT, f), f])
  const problems = files.flatMap(([file, at]) => linkProblems(readFileSync(file, 'utf8'), at))
  for (const p of problems) console.error(p)
  if (problems.length > 0) process.exit(1)
  console.log(`Every link in ${files.length} Markdown file(s) resolves.`)
}

if (process.argv[1] && process.argv[1].endsWith('check-links.mjs')) main()
