#!/usr/bin/env node
/**
 * The README npm will show for each published package, checked in the tarball itself: `pnpm pack`
 * (which runs the package's prepack and postpack, so scripts/readmes.mjs --pack/--unpack), then
 *
 * 1. the packed README is the committed one with its shared sections filled and its links made
 *    absolute at tag v<version> (scripts/readmes.mjs), nothing more or less;
 * 2. it has no relative link left, and every link to this repository names a path that exists here;
 * 3. every example of the CLI's output in it matches the CLI's real output
 *    (scripts/check-readme-examples.mjs --doc);
 * 4. the committed README is back as it was, with nothing left over from the pack.
 *
 *   node scripts/check-packed-readmes.mjs             (after pnpm build; CI runs it)
 *   node scripts/check-packed-readmes.mjs --selftest  the checks above catch the README edits that
 *                                                     would break an npm page (no packing)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { linkProblems } from './check-links.mjs'
import { ROOT, fillShared, relativeLinks, rewriteLinks } from './readmes.mjs'

// Each edit is one way an npm page breaks; every check must catch its own.
if (process.argv.includes('--selftest')) {
  const at = 'packages/cli/README.md'
  const cases = [
    ['a relative link survives packing', () => relativeLinks('[docs](../../docs/evaluation.md)').length === 1],
    ['a badge whose link is relative', () => relativeLinks('[![License](https://img.shields.io/x.svg)](LICENSE)').length === 1],
    ['an HTML image with a relative src', () => relativeLinks('<img src="logo.png">').length === 1],
    ['packing rewrites a badge link to the tag', () => rewriteLinks('[![L](https://img.shields.io/x.svg)](LICENSE)', 'packages/cli', 'v9.9.9') === '[![L](https://img.shields.io/x.svg)](https://github.com/x96x64/ctxjev/blob/v9.9.9/packages/cli/LICENSE)'],
    ['packing rewrites a link whose text is code', () => rewriteLinks('[`a`](../../README.md)', 'packages/cli', 'v9.9.9') === '[`a`](https://github.com/x96x64/ctxjev/blob/v9.9.9/README.md)'],
    ['packing moves a main-branch link to the tag', () => rewriteLinks('[x](https://github.com/x96x64/ctxjev/blob/main/README.md)', 'packages/cli', 'v9.9.9').includes('/blob/v9.9.9/README.md')],
    ['packing leaves code alone', () => rewriteLinks('`[x](../../README.md)`', 'packages/cli', 'v9.9.9') === '`[x](../../README.md)`'],
    ['packing refuses a link to a missing file', () => { try { rewriteLinks('[x](../../nope.md)', 'packages/cli', 'v9.9.9'); return false } catch { return true } }],
    ['a link to a missing file', () => linkProblems('[x](../../nope.md)', at).length === 1],
    ['a link to a missing heading', () => linkProblems('[x](../../README.md#no-such-heading)', at).length === 1],
    ['a pinned link to a missing path', () => linkProblems('[x](https://github.com/x96x64/ctxjev/blob/v9.9.9/nope.md)', at).length === 1],
    ['a shared section edited by hand', () => fillShared('<!-- shared:license -->\nedited\n<!-- /shared:license -->') !== '<!-- shared:license -->\nedited\n<!-- /shared:license -->'],
  ]
  let ok = true
  for (const [what, caught] of cases) {
    const result = caught()
    console.log(`${result ? 'caught' : 'MISSED'}: ${what}`)
    if (!result) ok = false
  }
  process.exit(ok ? 0 : 1)
}

const PUBLISHED = ['packages/core', 'packages/cli', 'packages/mcp-server']
const problems = []

for (const pkg of PUBLISHED) {
  const dir = join(ROOT, pkg)
  const { name, version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const committed = readFileSync(join(dir, 'README.md'), 'utf8')
  const out = mkdtempSync(join(tmpdir(), 'ctxjev-pack-'))
  try {
    execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] })
    const tarball = readdirSync(out).find((f) => f.endsWith('.tgz'))
    const packed = execFileSync('tar', ['-xzOf', join(out, tarball), 'package/README.md'], { encoding: 'utf8' })
    const file = join(out, 'README.md')
    writeFileSync(file, packed)

    const expected = rewriteLinks(fillShared(committed), pkg, `v${version}`)
    if (packed !== expected) problems.push(`${name}: the packed README isn't the committed one with its shared sections filled and its links made absolute`)
    if (packed === committed) problems.push(`${name}: the packed README is the committed one unchanged: prepack didn't run`)
    for (const link of relativeLinks(packed)) problems.push(`${name}: a relative link in the packed README: ${link}`)
    const pinned = [...packed.matchAll(/https:\/\/github\.com\/x96x64\/ctxjev\/(?:blob|tree)\/([^/)\s]+)\//g)].map((m) => m[1])
    for (const ref of new Set(pinned)) if (ref !== `v${version}`) problems.push(`${name}: links to ${ref}, not the release tag v${version}`)
    problems.push(...linkProblems(packed, `${pkg}/README.md`).map((p) => `${name} (packed): ${p}`))

    const examples = spawnSync('node', [join(ROOT, 'scripts/check-readme-examples.mjs'), '--doc', file], { encoding: 'utf8' })
    if (examples.status !== 0 && !/no example found/.test(examples.stdout)) problems.push(`${name}: an example in the packed README doesn't match the CLI's real output:\n${examples.stdout}`)
    else if (examples.status === 0) console.log(`${name}: ${examples.stdout.trim().split('\n').at(-1)}`)

    if (readFileSync(join(dir, 'README.md'), 'utf8') !== committed) problems.push(`${name}: the committed README wasn't put back after the pack`)
    if (existsSync(join(dir, '.README.committed.md'))) problems.push(`${name}: .README.committed.md was left behind`)
    console.log(`${name}@${version}: packed README checked (${pinned.length} links pinned to v${version})`)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p)
  process.exit(1)
}
console.log(`The packed READMEs of ${PUBLISHED.length} packages are what npm should show.`)
