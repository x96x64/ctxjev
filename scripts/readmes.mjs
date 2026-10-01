#!/usr/bin/env node
/**
 * The package READMEs: their shared sections, and the copy npm shows.
 *
 * npm shows only the README inside a package, so every package README carries the sections in
 * docs/readme-shared/ (about, privacy, status, license) word for word, between
 * `<!-- shared:NAME -->` and `<!-- /shared:NAME -->`.
 *
 *   node scripts/readmes.mjs            check: every package README has every shared section, as it is
 *                                       in docs/readme-shared/ (CI runs this)
 *   node scripts/readmes.mjs --write    copy the shared sections in
 *   node scripts/readmes.mjs --pack     (a package's prepack) fill the shared sections and rewrite every
 *                                       relative link, and every link to this repository's main
 *                                       branch, to an absolute GitHub URL at tag v<version>; the
 *                                       committed README is kept aside and put back by --unpack
 *   node scripts/readmes.mjs --unpack   (postpack) put the committed README back
 *
 * `rewriteLinks()` is exported for scripts/check-packed-readmes.mjs.
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_URL = 'https://github.com/x96x64/ctxjev'
export const PACKAGES = ['packages/core', 'packages/cli', 'packages/mcp-server', 'packages/claude-plugin']
const SHARED_DIR = join(ROOT, 'docs/readme-shared')
const SHARED = ['about', 'privacy', 'status', 'license']
const KEPT_ASIDE = '.README.committed.md'

// A Markdown link or image, whose text may itself hold one level of brackets: the badge
// `[![License](https://…)](LICENSE)` is a link whose text is an image.
export const LINK = /(!?)\[((?:[^[\]]|\[[^[\]]*\])*)\]\(([^)\s]+)\)/g

const shared = (name) => readFileSync(join(SHARED_DIR, `${name}.md`), 'utf8')
const BLOCK = /<!-- shared:([\w-]+) -->\n([\s\S]*?)<!-- \/shared:\1 -->/g

/** `text` with every shared block's content replaced by docs/readme-shared/NAME.md. */
export function fillShared(text) {
  return text.replace(BLOCK, (_whole, name) => `<!-- shared:${name} -->\n${shared(name)}<!-- /shared:${name} -->`)
}

/** What's wrong with one package README's shared sections. */
function sharedProblems(file, text) {
  const problems = []
  const found = [...text.matchAll(BLOCK)].map((m) => m[1])
  for (const name of SHARED) if (!found.includes(name)) problems.push(`${file}: no <!-- shared:${name} --> section`)
  for (const name of found) if (!SHARED.includes(name)) problems.push(`${file}: unknown shared section "${name}"`)
  if (fillShared(text) !== text) problems.push(`${file}: a shared section differs from docs/readme-shared/ — run node scripts/readmes.mjs --write`)
  return problems
}

/**
 * Code (fenced or inline) is left exactly as it is; only prose links are rewritten. Inline code is
 * swapped for a placeholder first rather than split out, so a link whose text is code
 * ([`file.json`](…)) is still one link.
 */
const MARK = String.fromCharCode(0)
function outsideCode(text, rewrite) {
  return text
    .split(/(^```[\s\S]*?^```$)/m)
    .map((part, i) => {
      if (i % 2 === 1) return part
      const spans = []
      const masked = part.replace(/`[^`\n]*`/g, (code) => `${MARK}${spans.push(code) - 1}${MARK}`)
      return rewrite(masked).replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_m, n) => spans[Number(n)])
    })
    .join('')
}

/**
 * Every relative link in `text` (a README in `fromDir`, repo-relative) as an absolute URL at `ref`,
 * and every link to this repository's main branch moved to `ref` too. A link to a file that isn't
 * in the repository is an error, not a broken link on npm.
 */
export function rewriteLinks(text, fromDir, ref) {
  const absolute = (target, image) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) {
      return target.replace(new RegExp(`^${REPO_URL}/(blob|tree)/main/`), `${REPO_URL}/$1/${ref}/`)
    }
    const [path, anchor] = target.split('#')
    const repoPath = posix.normalize(posix.join(fromDir, path)).replace(/\/$/, '')
    if (repoPath.startsWith('..')) throw new Error(`${fromDir}: a link outside the repository: ${target}`)
    const onDisk = join(ROOT, repoPath)
    if (!existsSync(onDisk)) throw new Error(`${fromDir}: a link to ${repoPath}, which isn't in the repository`)
    const kind = statSync(onDisk).isDirectory() ? 'tree' : 'blob'
    return `${REPO_URL}/${kind}/${ref}/${repoPath}${image ? '?raw=true' : ''}${anchor !== undefined ? `#${anchor}` : ''}`
  }
  const links = (prose) => prose.replace(LINK, (_m, bang, label, target) => `${bang}[${links(label)}](${absolute(target, bang === '!')})`)
  return outsideCode(text, (prose) =>
    links(prose)
      .replace(/\b(href|src)="([^"]+)"/g, (_m, attr, target) => `${attr}="${absolute(target, attr === 'src')}"`)
      .replace(/^(\[[^\]]+\]:\s*)(\S+)/gm, (_m, lead, target) => `${lead}${absolute(target, false)}`),
  )
}

/** Links a packed README may not contain: anything that isn't absolute, or an in-page anchor. */
export function relativeLinks(text) {
  const found = []
  outsideCode(text, (prose) => {
    const collect = (part) => {
      for (const m of part.matchAll(LINK)) {
        if (!/^(?:https?:|mailto:|#)/i.test(m[3])) found.push(m[3])
        collect(m[2])
      }
    }
    collect(prose)
    for (const m of prose.matchAll(/\b(?:href|src)="([^"]+)"|^\[[^\]]+\]:\s*(\S+)/gm)) {
      const target = m[1] ?? m[2]
      if (!/^(?:https?:|mailto:|#)/i.test(target)) found.push(target)
    }
    return prose
  })
  return found
}

const version = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--pack') || args.includes('--unpack')) {
    const dir = process.cwd()
    const readme = join(dir, 'README.md')
    const aside = join(dir, KEPT_ASIDE)
    if (args.includes('--unpack')) {
      if (existsSync(aside)) renameSync(aside, readme)
      return
    }
    if (existsSync(aside)) throw new Error(`${aside} exists: a previous pack didn't finish. Put it back as README.md first.`)
    const text = readFileSync(readme, 'utf8')
    const packed = rewriteLinks(fillShared(text), relative(ROOT, dir).split('\\').join('/'), `v${version(dir)}`)
    renameSync(readme, aside)
    writeFileSync(readme, packed)
    return
  }

  const problems = []
  for (const name of SHARED) if (!existsSync(join(SHARED_DIR, `${name}.md`))) problems.push(`docs/readme-shared/${name}.md is missing`)
  for (const pkg of PACKAGES) {
    const file = `${pkg}/README.md`
    if (existsSync(join(ROOT, pkg, KEPT_ASIDE))) problems.push(`${pkg}/${KEPT_ASIDE} is left over from a pack that didn't finish`)
    const text = readFileSync(join(ROOT, file), 'utf8')
    if (args.includes('--write')) {
      const filled = fillShared(text)
      if (filled !== text) {
        writeFileSync(join(ROOT, file), filled)
        console.log(`rewrote the shared sections in ${file}`)
      }
      problems.push(...sharedProblems(file, filled))
    } else problems.push(...sharedProblems(file, text))
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(p)
    process.exit(1)
  }
  console.log(`Every package README carries the ${SHARED.length} shared sections as they are in docs/readme-shared/.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
