#!/usr/bin/env node
/**
 * Long-history variants of the recorded sessions, for the round-2 plugin comparison
 * (PREREGISTRATION.md, "Round 2: long histories").
 *
 * The recorded histories are 3k-23k tokens: short enough that a compaction summary can keep nearly
 * everything, which is why "summary alone" passed every holdout task. Real sessions that get
 * compacted are far longer, and most of their length is tool output that doesn't matter: access
 * logs, dependency trees, lint noise, file listings, unrelated commits. This pads each history
 * with exactly that, generated deterministically (seeded by the task name) and unrelated to any
 * task's domain, until it reaches `targetTokens`.
 *
 * Nothing in the original history is removed or changed: every original message keeps its content
 * and order, so probe and label entry ids still resolve. Each padding step is one assistant
 * tool_use and its tool_result, inserted after a user message and before the assistant message
 * that answered it, so the conversation still alternates.
 *
 *   node eval/lengthen.mjs [--target 80000] [--split dev|holdout|all]   # sizes and a hash per task
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { messagesToEntries } from '../dist/index.js'

export const DEFAULT_TARGET_TOKENS = 80_000

const tokensOf = (messages) => messagesToEntries(messages).reduce((sum, e) => sum + e.sourceTokens, 0)

function prng(seedText) {
  let seed = createHash('sha256').update(seedText).digest().readUInt32LE(0)
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)]
const hex = (rand, n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('')
const pad2 = (n) => String(n).padStart(2, '0')

const PATHS = ['/healthz', '/metrics', '/api/v2/profile', '/api/v2/notifications', '/api/v2/preferences', '/api/v2/locale', '/static/app.js', '/static/vendor.js', '/static/styles.css', '/favicon.ico', '/api/v2/avatars', '/api/v2/feature-list', '/i18n/messages.json', '/robots.txt']
const PACKAGES = ['debug', 'ms', 'semver', 'chalk', 'yargs', 'minimist', 'commander', 'dotenv', 'glob', 'rimraf', 'mkdirp', 'picomatch', 'micromatch', 'braces', 'fill-range', 'to-regex-range', 'is-number', 'ansi-styles', 'supports-color', 'has-flag', 'color-convert', 'color-name', 'strip-ansi', 'ansi-regex', 'wrap-ansi', 'string-width', 'emoji-regex', 'cliui', 'y18n', 'escalade', 'get-caller-file', 'require-directory', 'prettier', 'eslint', 'espree', 'acorn', 'esquery', 'estraverse', 'esutils', 'levn', 'optionator', 'type-check', 'prelude-ls', 'fast-deep-equal', 'json-schema-traverse', 'uri-js', 'punycode', 'ajv', 'graceful-fs', 'once', 'wrappy', 'inherits', 'inflight', 'path-is-absolute', 'fs.realpath', 'minimatch', 'brace-expansion', 'balanced-match', 'concat-map']
const UI_FILES = ['src/ui/header.js', 'src/ui/footer.js', 'src/ui/avatar.js', 'src/ui/theme.js', 'src/ui/modal.js', 'scripts/build-icons.js', 'scripts/sync-locales.js', 'src/i18n/format.js', 'src/ui/toast.js', 'src/ui/tooltip.js']
const RULES = [['no-unused-vars', "'%s' is defined but never used"], ['prefer-const', "'%s' is never reassigned. Use 'const' instead"], ['no-console', 'Unexpected console statement'], ['eqeqeq', "Expected '===' and instead saw '=='"], ['no-shadow', "'%s' is already declared in the upper scope"]]
const NAMES = ['idx', 'el', 'opts', 'tmp', 'node', 'item', 'ctx', 'res', 'val', 'key']
const COMMITS = ['docs: fix typo in CONTRIBUTING', 'ci: bump node to 20.x in workflow', 'chore(deps): bump %s from %s to %s', 'style: run prettier on scripts/', 'chore: update .editorconfig', 'docs: add screenshot to README', 'ci: cache pnpm store', 'chore(deps-dev): bump %s from %s to %s', 'refactor(ui): extract tooltip positioning', 'chore: regenerate icon sprite']
const AUTHORS = ['dependabot[bot] <support@github.com>', 'Mina Park <mina@example.com>', 'Tom Reyes <tom@example.com>', 'Ada Novak <ada@example.com>']
const ASSET_DIRS = ['public/icons', 'public/fonts', 'src/i18n/locales', 'src/ui', 'scripts', 'docs/images', '.github/workflows']
const ASSET_EXT = { 'public/icons': 'svg', 'public/fonts': 'woff2', 'src/i18n/locales': 'json', 'src/ui': 'js', scripts: 'js', 'docs/images': 'png', '.github/workflows': 'yml' }
const version = (rand) => `${Math.floor(rand() * 9)}.${Math.floor(rand() * 20)}.${Math.floor(rand() * 12)}`

const GENERATORS = [
  function accessLog(rand) {
    const day = 10 + Math.floor(rand() * 18)
    const lines = []
    let t = Math.floor(rand() * 3600)
    for (let i = 0; i < 180; i++) {
      t += 1 + Math.floor(rand() * 20)
      const status = rand() < 0.93 ? 200 : pick(rand, [304, 404, 499])
      lines.push(`2026-08-${day}T${pad2(Math.floor(t / 3600) % 24)}:${pad2(Math.floor(t / 60) % 60)}:${pad2(t % 60)}.${String(Math.floor(rand() * 1000)).padStart(3, '0')}Z INFO http ${pick(rand, ['GET', 'GET', 'GET', 'HEAD'])} ${pick(rand, PATHS)} ${status} ${1 + Math.floor(rand() * 90)}ms req=${hex(rand, 12)}`)
    }
    return { command: `head -180 logs/access-2026-08-${day}.log`, description: 'Skim the access log', output: lines.join('\n') }
  },
  function dependencyTree(rand) {
    const lines = ['app@1.0.0 /workspace/app']
    for (let i = 0; i < 110; i++) {
      const depth = 1 + Math.floor(rand() * 4)
      lines.push(`${'│ '.repeat(depth - 1)}${rand() < 0.8 ? '├──' : '└──'} ${pick(rand, PACKAGES)}@${version(rand)}${rand() < 0.2 ? ' deduped' : ''}`)
    }
    return { command: 'npm ls --all 2>/dev/null | head -110', description: 'List installed dependencies', output: lines.join('\n') }
  },
  function lint(rand) {
    const lines = []
    let problems = 0
    for (const file of [...UI_FILES].sort(() => rand() - 0.5).slice(0, 6)) {
      lines.push('', `/workspace/app/${file}`)
      for (let i = 0; i < 6 + Math.floor(rand() * 10); i++) {
        const [rule, text] = pick(rand, RULES)
        lines.push(`  ${1 + Math.floor(rand() * 300)}:${1 + Math.floor(rand() * 60)}  warning  ${text.replace('%s', pick(rand, NAMES))}  ${rule}`)
        problems++
      }
    }
    lines.push('', `✖ ${problems} problems (0 errors, ${problems} warnings)`)
    return { command: 'npx eslint . 2>&1 | tail -120', description: 'Run the linter', output: lines.join('\n') }
  },
  function gitLog(rand) {
    const lines = []
    for (let i = 0; i < 16; i++) {
      const message = pick(rand, COMMITS).replace('%s', pick(rand, PACKAGES)).replace('%s', version(rand)).replace('%s', version(rand))
      lines.push(`commit ${hex(rand, 40)}`, `Author: ${pick(rand, AUTHORS)}`, `Date:   Mon Aug ${pad2(1 + Math.floor(rand() * 28))} ${pad2(Math.floor(rand() * 24))}:${pad2(Math.floor(rand() * 60))}:00 2026 +0000`, '', `    ${message}`, '')
      for (let j = 0; j < 1 + Math.floor(rand() * 3); j++) lines.push(` ${pick(rand, ['package-lock.json', 'README.md', 'CONTRIBUTING.md', '.github/workflows/ci.yml', ...UI_FILES])} | ${1 + Math.floor(rand() * 400)} ${'+'.repeat(1 + Math.floor(rand() * 20))}${'-'.repeat(Math.floor(rand() * 10))}`)
      lines.push('')
    }
    return { command: 'git log --stat -16 -- docs/ .github/ src/ui/ package-lock.json', description: 'Recent unrelated changes', output: lines.join('\n') }
  },
  function fileList(rand) {
    const lines = []
    for (let i = 0; i < 160; i++) {
      const dir = pick(rand, ASSET_DIRS)
      lines.push(`./${dir}/${pick(rand, NAMES)}-${hex(rand, 6)}.${ASSET_EXT[dir]}`)
    }
    return { command: "find . -type f -not -path './node_modules/*' -not -path './.git/*' | head -160", description: 'List the repository files', output: lines.sort().join('\n') }
  },
]

/**
 * `history` padded to about `targetTokens` with irrelevant tool traffic, deterministically for a
 * given `seed`. Returns a new array; the input is not modified.
 */
export function lengthenHistory(history, seed, targetTokens = DEFAULT_TARGET_TOKENS) {
  return lengthen(history, seed, targetTokens).messages
}

/**
 * The same, plus `remapId`: padding moves original messages to new positions, so an entry id like
 * `msg:36` or `msg:35:0` (messagesToEntries' ids, which probes and labels use) needs its index
 * translated. Tool ids (`tool:toolu_…`) don't depend on position and pass through unchanged.
 */
export function lengthen(history, seed, targetTokens = DEFAULT_TARGET_TOKENS) {
  const rand = prng(seed)
  // Insertion points: after a user message whose next message is the assistant's.
  const slots = history.flatMap((m, i) => (m.role === 'user' && history[i + 1]?.role === 'assistant' ? [i] : []))
  if (slots.length === 0) return { messages: [...history], remapId: (id) => id }
  const inserts = new Map(slots.map((i) => [i, []]))
  let total = tokensOf(history)
  for (let n = 0; total < targetTokens; n++) {
    const { command, description, output } = pick(rand, GENERATORS)(rand)
    const id = `toolu_pad_${createHash('sha256').update(`${seed}:${n}`).digest('hex').slice(0, 20)}`
    const pair = [
      { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] },
    ]
    inserts.get(slots[n % slots.length]).push(...pair)
    total += tokensOf(pair)
  }
  const newIndex = []
  const messages = []
  history.forEach((m, i) => {
    newIndex[i] = messages.length
    messages.push(m, ...(inserts.get(i) ?? []))
  })
  const remapId = (id) => id.replace(/^msg:(\d+)/, (_, i) => `msg:${newIndex[Number(i)] ?? i}`)
  return { messages, remapId }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const { inSplit, parseSplit, taskSplit } = await import('./split.mjs')
  const here = dirname(fileURLToPath(import.meta.url))
  const tasksDir = join(here, '../../../examples/eval-tasks')
  const sessionsDir = join(here, '../../../examples/eval-sessions')
  const { values: args } = parseArgs({ options: { target: { type: 'string' }, split: { type: 'string', default: 'all' } } })
  const target = Number(args.target ?? DEFAULT_TARGET_TOKENS)
  const split = parseSplit(args.split)
  for (const task of readdirSync(tasksDir).filter((d) => statSync(join(tasksDir, d)).isDirectory() && inSplit(taskSplit(d), split))) {
    const sessionPath = join(sessionsDir, `recorded-${task}.json`)
    if (!existsSync(sessionPath)) continue
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
    const history = session.messages.slice(0, session.cutAfterMessage + 1)
    const long = lengthenHistory(history, task, target)
    const hash = createHash('sha256').update(JSON.stringify(long)).digest('hex').slice(0, 12)
    console.log(`${task.padEnd(22)} ${String(tokensOf(history)).padStart(6)} → ${String(tokensOf(long)).padStart(6)} tokens, ${history.length} → ${long.length} messages, sha256 ${hash}`)
  }
}
