#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import pc from 'picocolors'
import {
  DEFAULT_POLICY,
  createUsageAccumulator,
  estimateTokens,
  pruneContext,
  pruneMessages,
  summarizeSavings,
  type Entry,
  type JevUsage,
  type PruneDecision,
  type PruningPolicy,
  type ScoreCache,
} from 'ctxjev-core'
import { formatReport } from './report.js'
import { DEFAULT_CACHE_PATH, loadFileScoreCache } from './scoreCache.js'
import { parseTranscript, type TranscriptFile } from './transcript.js'
import { describePolicyOrderingError, parseThreshold } from './validation.js'

// Read from this package's own package.json rather than a hardcoded constant, so --version
// can't silently go stale after the next release the way a literal string would.
const VERSION: string = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
).version

const HELP = `${pc.bold('ctxjev')} — score and prune AI agent context with Jev

${pc.bold('Try it right now')}
  curl -O https://raw.githubusercontent.com/x96x64/ctxjev/main/examples/sample-transcripts/checkout-bug.json
  ctxjev analyze checkout-bug.json

${pc.bold('Usage')}
  ctxjev analyze <transcript> [--goal "<current task>"] [options]   Report what would be kept, dropped, or summarized.
  ctxjev prune <transcript> [--goal "<current task>"] [options]     Write the transcript back out with drops removed.

${pc.bold('Options')}
  --goal <text>              Overrides the transcript's own goal (or the inferred one), if any.
  --drop-below <0-1>         Relevance floor below which an entry is dropped.      (default ${DEFAULT_POLICY.dropBelow})
  --summarize-below <0-1>    Relevance floor below which an entry is summarized.   (default ${DEFAULT_POLICY.summarizeBelow})
  --offline                  Score by keyword overlap instead of Jev: no API key, nothing sent.
                             Much cruder, so the default thresholds are only a rough guide.
  --no-cache                 Don't read or write the score cache (${DEFAULT_CACHE_PATH}).
  --json                     analyze: print machine-readable JSON instead of the report.
  --out <file>               prune: write the result here instead of to stdout.
  --protect-last <n>         prune, Anthropic Messages only: never touch the last n messages. (default 2)
  --help                     Show this help.
  --version                  Print the installed version.

Scores are cached by goal + entry content (not by transcript or entry id), so re-running the same
analysis, or reusing a tool result across transcripts, costs nothing the second time.

${pc.bold('Transcript formats (auto-detected)')}
  ctxjev's own:        { "goal": "...", "entries": [{ "id", "role", "toolName"?, "content", "timestamp" }] }
  Anthropic Messages:  a "messages" array, bare or as { "goal"?, "messages" }. prune keeps every
                       tool_use/tool_result pair intact, so the result is still a valid request.
  Claude Code:         a real session .jsonl (analyze only). The goal is inferred from your most
                       recent chat message unless --goal overrides it.
  See examples/sample-transcripts in the ctxjev repo for examples.
`

function fail(message: string): never {
  console.error(`${pc.red('✖')} ${message}`)
  process.exit(1)
}

function failAll(messages: string[]): never {
  for (const message of messages) console.error(`${pc.red('✖')} ${message}`)
  process.exit(1)
}

type Scorer = 'jev' | 'local'

type Setup = {
  transcript: TranscriptFile
  goal: string
  policy: PruningPolicy
  scorer: Scorer
  noCache: boolean
  values: Record<string, string | boolean | undefined>
}

async function setUp(argv: string[], extraOptions: Record<string, { type: 'string' | 'boolean'; default?: string | boolean }>): Promise<Setup> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      goal: { type: 'string' },
      'drop-below': { type: 'string' },
      'summarize-below': { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      ...extraOptions,
    },
  })

  const [file] = positionals
  if (!file) fail('missing <transcript> — see `ctxjev --help`')

  // Every problem checked up front, independently, and all of them reported together — a user
  // missing the key, pointing at a bad path, AND passing a bad threshold should hear about all
  // three in one run, not fix one only to discover the next on the following try.
  const problems: string[] = []
  const scorer: Scorer = values.offline ? 'local' : 'jev'
  if (scorer === 'jev' && !process.env.TYPESAFE_API_KEY) {
    problems.push('TYPESAFE_API_KEY is not set — get one at console.typesafe.ai/settings/keys, or pass --offline')
  }

  let raw: string | undefined
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    problems.push(`couldn't read ${file}`)
  }

  let dropBelow = DEFAULT_POLICY.dropBelow
  if (values['drop-below'] !== undefined) {
    const parsed = parseThreshold(values['drop-below'] as string)
    if (parsed === undefined) problems.push(`--drop-below must be a number between 0 and 1, got "${values['drop-below']}"`)
    else dropBelow = parsed
  }

  let summarizeBelow = DEFAULT_POLICY.summarizeBelow
  if (values['summarize-below'] !== undefined) {
    const parsed = parseThreshold(values['summarize-below'] as string)
    if (parsed === undefined) problems.push(`--summarize-below must be a number between 0 and 1, got "${values['summarize-below']}"`)
    else summarizeBelow = parsed
  }

  const orderingError = describePolicyOrderingError(dropBelow, summarizeBelow)
  if (orderingError) problems.push(orderingError)

  if (problems.length > 0) failAll(problems)

  const transcript = parseTranscript(raw!)
  const goal = (values.goal as string | undefined) ?? transcript.goal
  if (!goal) fail('no goal — pass --goal or set "goal" in the transcript file')

  const policy: PruningPolicy = { dropBelow, summarizeBelow, recencyWeight: DEFAULT_POLICY.recencyWeight }
  return { transcript, goal, policy, scorer, noCache: Boolean(values['no-cache']), values }
}

/**
 * Runs `score` with the file-backed score cache wired in, and saves it afterward even if scoring
 * failed partway — verdicts already paid for shouldn't be re-bought on the next run. A failure to
 * save only warns: it must never replace a result that already succeeded.
 */
async function withScoreCache<T>(setup: Setup, score: (options: { cache?: ScoreCache; onUsage: (u: JevUsage) => void }) => Promise<T>) {
  // The cache holds Jev's scores only; offline scoring is free and must never mix into it.
  const { cache, save } = setup.noCache || setup.scorer === 'local' ? { cache: undefined, save: async () => {} } : await loadFileScoreCache()
  const { usage, onUsage } = createUsageAccumulator()
  try {
    return { result: await score({ cache, onUsage }), usage }
  } finally {
    try {
      await save()
    } catch (err) {
      console.error(`${pc.yellow('⚠')} could not save the score cache: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function runAnalyze(argv: string[]) {
  const setup = await setUp(argv, { json: { type: 'boolean', default: false } })
  const { transcript, goal, policy, scorer } = setup

  const { result: decisions, usage } = await withScoreCache(setup, (options) => pruneContext(transcript.entries, goal, policy, { ...options, scorer }))
  const savings = summarizeSavings(transcript.entries, decisions)

  if (setup.values.json) {
    console.log(JSON.stringify({ decisions, savings, usage, scorer }, null, 2))
    return
  }
  console.log(formatReport(transcript.entries, decisions, savings, usage, scorer))
}

async function runPrune(argv: string[]) {
  const setup = await setUp(argv, { out: { type: 'string' }, 'protect-last': { type: 'string' } })
  const { transcript, goal, policy, scorer, values } = setup

  if (transcript.format === 'claude-code') {
    fail("prune can't write back a Claude Code transcript — Claude Code doesn't load an edited one. Use `ctxjev analyze`, or the ctxjev Claude Code plugin.")
  }

  let protectLast = 2
  if (values['protect-last'] !== undefined) {
    protectLast = Number(values['protect-last'])
    if (!Number.isInteger(protectLast) || protectLast < 1) fail(`--protect-last must be a whole number of at least 1, got "${values['protect-last']}"`)
  }

  let output: unknown
  let decisions: PruneDecision[]
  let removed: Set<string>
  if (transcript.format === 'anthropic-messages') {
    const { result } = await withScoreCache(setup, (options) => pruneMessages(transcript.messages, goal, { ...options, scorer, policy, protectLast }))
    output = transcript.wrapped ? { goal, messages: result.messages } : result.messages
    decisions = result.decisions
    removed = new Set(result.removed)
  } else {
    const { result } = await withScoreCache(setup, (options) => pruneContext(transcript.entries, goal, policy, { ...options, scorer }))
    decisions = result
    removed = new Set(result.filter((d) => d.action === 'drop').map((d) => d.entryId))
    output = { goal, entries: transcript.entries.filter((e) => !removed.has(e.id)) }
  }

  const json = `${JSON.stringify(output, null, 2)}\n`
  if (values.out) await writeFile(values.out as string, json, 'utf8')
  else process.stdout.write(json)

  console.error(pruneSummary(transcript.entries, decisions, removed, scorer))
}

function pruneSummary(entries: Entry[], decisions: PruneDecision[], removed: Set<string>, scorer: Scorer): string {
  const removedTokens = entries.filter((e) => removed.has(e.id)).reduce((sum, e) => sum + estimateTokens(e.content), 0)
  const kept = decisions.filter((d) => d.action === 'drop').length - removed.size
  const protectedNote = kept > 0 ? ` (${kept} marked drop but protected)` : ''
  const offline = scorer === 'local' ? ' · scored offline by keyword overlap' : ''
  return pc.dim(`removed ${removed.size} of ${entries.length} entries, ~${removedTokens.toLocaleString()} tokens${protectedNote}${offline}`)
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP)
    return
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION)
    return
  }

  if (command === 'analyze') {
    await runAnalyze(rest)
    return
  }

  if (command === 'prune') {
    await runPrune(rest)
    return
  }

  fail(`unknown command "${command}" — see \`ctxjev --help\``)
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err))
})
