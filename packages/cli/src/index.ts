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
  type JevUsage,
  type PruningPolicy,
  type ScoreCache,
} from 'ctxjev-core'
import { formatMessagesOutcome, formatReport, jevCostLine, type PruneOutcome } from './report.js'
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
  ctxjev analyze <transcript> [--goal "<current task>"] [options]   Report each entry's verdict and what prune would remove.
  ctxjev prune <transcript> [--goal "<current task>"] [options]     Write the transcript back out with drops removed.

${pc.bold('Options')}  (analyze takes prune's options too, and reports what prune would do with them)
  --goal <text>              Overrides the transcript's own goal (or the inferred one), if any.
  --drop-below <0-1>         Score below which an entry is marked drop.            (default ${DEFAULT_POLICY.dropBelow})
  --summarize-below <0-1>    Score below which an entry is marked summarize.       (default ${DEFAULT_POLICY.summarizeBelow})
  --scorer <name>            recency (default: by position alone, offline, plain truncation),
                             local (keyword overlap, offline), or jev (sends entry content to Jev;
                             see console.typesafe.ai). Pass --scorer jev to opt in.
  --offline                  Same as --scorer local.
  --no-cache                 Don't read or write the score cache (${DEFAULT_CACHE_PATH}).
  --json                     analyze: print machine-readable JSON instead of the report (with what
                             prune would do, for an Anthropic Messages transcript).
  --out <file>               prune: write the result here instead of to stdout.
  --protect-last <n>         Anthropic Messages only: never touch the last n messages. (default 2)
  --no-protect-last-turn     Anthropic Messages only: let the latest turn (the last user message
                             with text, and every tool call after it) be pruned too; by default it
                             never is. Use it when the only instruction is the first message.
  --target-tokens <n>        Anthropic Messages only: after the drops, keep removing the
                             lowest-scoring entries until the conversation fits in n tokens.
  --summarize-excerpts       Anthropic Messages only: shorten entries marked summarize to the
                             head and tail of their text instead of leaving them as they are.
  --min-saved-tokens <n>     Anthropic Messages only: change nothing unless it saves at least
                             n tokens (any change invalidates a prompt cache from that point on).
  --drop-user-text           Anthropic Messages only: let what the user wrote be removed too
                             (by default it's kept: it's where constraints and changes of plan live).
  --no-marker                Anthropic Messages only: don't add the one-line note saying where
                             history was removed.
  --help, -h                 Show this help (before or after the command).
  --version, -v              Print the installed version (before or after the command).

Jev scores are cached by goal, entry content, and the latest activity (not by transcript or entry
id), so re-running the same analysis costs nothing the second time.

${pc.bold('Transcript formats (auto-detected)')}
  ctxjev's own:        { "goal": "...", "entries": [{ "id", "role", "toolName"?, "content", "timestamp" }] }
  Anthropic Messages:  a "messages" array, bare or as { "goal"?, "messages" }. prune keeps every
                       tool_use/tool_result pair intact, so the result is still a valid request.
  Claude Code:         a real session .jsonl (analyze only). The goal is inferred from your first
                       request plus your latest instruction unless --goal overrides it.
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

type Scorer = 'jev' | 'local' | 'recency'
const SCORERS: Scorer[] = ['jev', 'local', 'recency']

type Setup = {
  transcript: TranscriptFile
  goal: string
  policy: PruningPolicy
  scorer: Scorer
  noCache: boolean
  values: Record<string, string | boolean | undefined>
}

/** Node's parseArgs error, minus its advice about positionals starting with "-", plus where to look. */
function describeArgsError(command: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const unknown = /Unknown option '([^']+)'/.exec(message)
  if (unknown) return `unknown option '${unknown[1]}' for \`ctxjev ${command}\` — see \`ctxjev --help\``
  return `${message.replace(/\. To specify a positional argument[\s\S]*$/, '')} — see \`ctxjev --help\``
}

function parseOrFail<T>(command: string, parse: () => T): T {
  try {
    return parse()
  } catch (err) {
    fail(describeArgsError(command, err))
  }
}

async function setUp(command: string, argv: string[], extraOptions: Record<string, { type: 'string' | 'boolean'; default?: string | boolean }>): Promise<Setup> {
  const { positionals, values } = parseOrFail(command, () =>
    parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        goal: { type: 'string' },
        'drop-below': { type: 'string' },
        'summarize-below': { type: 'string' },
        'no-cache': { type: 'boolean', default: false },
        offline: { type: 'boolean', default: false },
        scorer: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
        ...extraOptions,
      },
    }),
  )

  if (values.help) {
    console.log(HELP)
    process.exit(0)
  }
  // After the command too (`ctxjev analyze --version`), as the README says.
  if (values.version) {
    console.log(VERSION)
    process.exit(0)
  }

  const [file] = positionals
  if (!file) fail('missing <transcript> — see `ctxjev --help`')

  // Every problem checked up front, independently, and all of them reported together — a user
  // missing the key, pointing at a bad path, AND passing a bad threshold should hear about all
  // three in one run, not fix one only to discover the next on the following try.
  const problems: string[] = []
  const requested = typeof values.scorer === 'string' ? values.scorer : values.offline ? 'local' : 'recency'
  const scorer: Scorer = SCORERS.includes(requested as Scorer) ? (requested as Scorer) : 'recency'
  if (!SCORERS.includes(requested as Scorer)) problems.push(`--scorer must be one of ${SCORERS.join(', ')}, got "${requested}"`)
  else if (values.offline && values.scorer !== undefined && values.scorer !== 'local') problems.push('--offline means --scorer local; pass one or the other')
  else if (scorer === 'jev' && !process.env.TYPESAFE_API_KEY) {
    problems.push('TYPESAFE_API_KEY is not set — get one at console.typesafe.ai/settings/keys, or drop --scorer jev to score offline')
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
  if (transcript.format === 'claude-code') for (const warning of transcript.warnings) console.error(`${pc.yellow('⚠')} ${warning}`)
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
  const { cache, save } = setup.noCache || setup.scorer !== 'jev' ? { cache: undefined, save: async () => {} } : await loadFileScoreCache()
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

// The settings that only an Anthropic Messages conversation has (messages to protect, a removal
// note to add). analyze takes them too, so it reports exactly what prune would do with them.
const MESSAGES_FLAGS = {
  'protect-last': { type: 'string' },
  'target-tokens': { type: 'string' },
  'min-saved-tokens': { type: 'string' },
  'summarize-excerpts': { type: 'boolean', default: false },
  'drop-user-text': { type: 'boolean', default: false },
  'no-marker': { type: 'boolean', default: false },
  'no-protect-last-turn': { type: 'boolean', default: false },
} as const

/** ctxjev's own format and a Claude Code transcript have no messages: a flag that can't apply is an error, never silently ignored. */
function rejectMessagesFlags(values: Setup['values']): void {
  const given = Object.keys(MESSAGES_FLAGS).filter((flag) => values[flag] !== undefined && values[flag] !== false)
  if (given.length > 0) fail(`${given.map((f) => `--${f}`).join(', ')} only ${given.length === 1 ? 'applies' : 'apply'} to an Anthropic Messages transcript`)
}

/** prune's Messages settings from the flags, validated the same way for both commands. */
function messagesSettings(values: Setup['values']) {
  const wholeNumber = (flag: string, min: number): number | undefined => {
    if (values[flag] === undefined) return undefined
    const n = Number(values[flag])
    if (!Number.isInteger(n) || n < min) fail(`--${flag} must be a whole number of at least ${min}, got "${values[flag]}"`)
    return n
  }
  const protectLast = wholeNumber('protect-last', 1) ?? 2
  return {
    protectLast,
    options: {
      protectLast,
      protectLastTurn: !values['no-protect-last-turn'],
      targetTokens: wholeNumber('target-tokens', 0),
      minSavedTokens: wholeNumber('min-saved-tokens', 0),
      summarize: values['summarize-excerpts'] ? ('excerpt' as const) : undefined,
      keepUserText: !values['drop-user-text'],
      marker: !values['no-marker'],
    },
  }
}

async function runAnalyze(argv: string[]) {
  const setup = await setUp('analyze', argv, { json: { type: 'boolean', default: false }, ...MESSAGES_FLAGS })
  const { transcript, goal, policy, scorer } = setup

  if (transcript.format !== 'anthropic-messages') {
    rejectMessagesFlags(setup.values)
    const { result: decisions, usage } = await withScoreCache(setup, (options) => pruneContext(transcript.entries, goal, policy, { ...options, scorer }))
    const savings = summarizeSavings(transcript.entries, decisions)
    if (setup.values.json) {
      console.log(JSON.stringify({ decisions, savings, usage, scorer }, null, 2))
      return
    }
    const outcome: PruneOutcome = transcript.format === 'claude-code' ? { format: 'claude-code' } : { format: 'entries' }
    console.log(formatReport(transcript.entries, decisions, savings, usage, scorer, outcome))
    return
  }

  // Scored once, by the same pruneMessages() call prune makes, so the report's numbers are prune's.
  const { protectLast, options: settings } = messagesSettings(setup.values)
  const { result, usage } = await withScoreCache(setup, (options) => pruneMessages(transcript.messages, goal, { ...options, scorer, policy, ...settings }))
  const savings = summarizeSavings(transcript.entries, result.decisions)
  if (setup.values.json) {
    const { messages: _messages, decisions, ...prune } = result
    console.log(JSON.stringify({ decisions, savings, prune, usage, scorer }, null, 2))
    return
  }
  console.log(formatReport(transcript.entries, result.decisions, savings, usage, scorer, { format: 'anthropic-messages', result, protectLast }))
}

async function runPrune(argv: string[]) {
  const setup = await setUp('prune', argv, { out: { type: 'string' }, ...MESSAGES_FLAGS })
  const { transcript, goal, policy, scorer, values } = setup

  if (transcript.format === 'claude-code') {
    fail("prune can't write back a Claude Code transcript — Claude Code doesn't load an edited one. Use `ctxjev analyze`, or the ctxjev Claude Code plugin.")
  }

  if (transcript.format !== 'anthropic-messages') {
    rejectMessagesFlags(values)
    const { result: decisions, usage } = await withScoreCache(setup, (options) => pruneContext(transcript.entries, goal, policy, { ...options, scorer }))
    const removed = new Set(decisions.filter((d) => d.action === 'drop').map((d) => d.entryId))
    await writeOutput({ goal, entries: transcript.entries.filter((e) => !removed.has(e.id)) }, values.out as string | undefined)
    const savedTokens = transcript.entries.filter((e) => removed.has(e.id)).reduce((sum, e) => sum + (e.sourceTokens ?? estimateTokens(e.content)), 0)
    console.error(pc.dim(`removed ${removed.size} of ${transcript.entries.length} entries, ~${savedTokens.toLocaleString()} tokens${offlineNote(scorer)}`))
    if (scorer === 'jev') console.error(pc.dim(jevCostLine(usage)))
    return
  }

  const { protectLast, options: settings } = messagesSettings(values)
  const { result, usage } = await withScoreCache(setup, (options) => pruneMessages(transcript.messages, goal, { ...options, scorer, policy, ...settings }))
  await writeOutput(transcript.wrapped ? { goal, messages: result.messages } : result.messages, values.out as string | undefined)
  console.error(pc.dim(formatMessagesOutcome(transcript.entries.length, result, protectLast, 'did')))
  if (scorer === 'jev') console.error(pc.dim(jevCostLine(usage)))
}

async function writeOutput(output: unknown, out: string | undefined): Promise<void> {
  const json = `${JSON.stringify(output, null, 2)}\n`
  if (out) await writeFile(out, json, 'utf8')
  else process.stdout.write(json)
}

function offlineNote(scorer: Scorer): string {
  return scorer === 'local' ? ' · scored offline by keyword overlap' : scorer === 'recency' ? ' · scored by position alone' : ''
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
