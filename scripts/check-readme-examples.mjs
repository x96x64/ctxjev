#!/usr/bin/env node
/**
 * Every `$ ctxjev …` console example in README.md and the package READMEs that doesn't use Jev,
 * run for real (offline, no key) and compared with what the README shows, byte for byte. Sample
 * files named in an example are the ones in examples/sample-transcripts/. The fourth audit's check 7
 * did this by hand; a change to the CLI's output (Round 4 added a warning) now can't leave a README
 * example stale.
 *
 *   node scripts/check-readme-examples.mjs                 # the built CLI (packages/cli/dist)
 *   node scripts/check-readme-examples.mjs --bin ctxjev    # an installed one (a release check)
 *   node scripts/check-readme-examples.mjs --doc FILE      # these files instead (a packed README)
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url))
const { values } = parseArgs({ options: { bin: { type: 'string' }, doc: { type: 'string', multiple: true } } })
const command = values.bin ?? `node ${JSON.stringify(join(root, 'packages/cli/dist/index.js'))}`
const samples = join(root, 'examples/sample-transcripts')

const examples = []
const DOCS = ['README.md', 'packages/core/README.md', 'packages/cli/README.md', 'packages/mcp-server/README.md', 'packages/claude-plugin/README.md']
for (const doc of values.doc ?? DOCS) {
  const text = readFileSync(values.doc ? doc : join(root, doc), 'utf8')
  for (const [, body] of text.matchAll(/```console\n([\s\S]*?)```/g)) {
    const [first, ...rest] = body.replace(/\n$/, '').split('\n')
    if (!first.startsWith('$ ctxjev ') || first.includes('--scorer jev')) continue
    examples.push({ doc, args: first.slice('$ ctxjev '.length), expected: rest.join('\n') })
  }
}

let failed = 0
for (const { doc, args, expected } of examples) {
  // A fresh directory holding the samples under both names an example uses.
  const dir = mkdtempSync(join(tmpdir(), 'ctxjev-readme-'))
  for (const file of readdirSync(samples)) copyFileSync(join(samples, file), join(dir, file))
  const shellArgs = args.replaceAll('examples/sample-transcripts/', '')
  const env = { PATH: process.env.PATH, HOME: dir, NO_COLOR: '1', TYPESAFE_BASE_URL: 'http://127.0.0.1:9' }
  const { stdout, status } = spawnSync('sh', ['-c', `${command} ${shellArgs} 2>&1`], { cwd: dir, env, encoding: 'utf8' })
  rmSync(dir, { recursive: true, force: true })
  const actual = stdout.replace(/\n$/, '')
  if (status === 0 && actual === expected) {
    console.log(`ok    ${doc}: ctxjev ${args}`)
    continue
  }
  failed++
  console.log(`FAIL  ${doc}: ctxjev ${args} (exit ${status})\n--- README\n${expected}\n--- actual\n${actual}\n---`)
}
if (examples.length === 0) {
  console.log('no example found')
  process.exit(1)
}
// How many each README has (issue #31): a change to the fence or prompt format that hid an example
// would otherwise pass with fewer. Update the count when you add or remove an example on purpose.
const EXPECTED = { 'README.md': 3, 'packages/cli/README.md': 1 }
if (!values.doc) {
  for (const doc of DOCS) {
    const found = examples.filter((e) => e.doc === doc).length
    if (found !== (EXPECTED[doc] ?? 0)) {
      console.log(`FAIL  ${doc}: ${found} example(s) found, ${EXPECTED[doc] ?? 0} expected (update EXPECTED if that's on purpose)`)
      failed++
    }
  }
}
console.log(`${examples.length - failed}/${examples.length} README examples match`)
process.exit(failed > 0 ? 1 : 0)
