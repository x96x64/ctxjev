#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import pc from 'picocolors'
import { DEFAULT_POLICY, pruneContext, summarizeSavings, type JevUsage, type PruningPolicy } from 'ctxjev-core'
import { formatReport } from './report.js'
import { parseTranscript } from './transcript.js'

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
  ctxjev analyze <transcript> --goal "<current task>" [options]

${pc.bold('Options')}
  --goal <text>              Overrides the transcript's own goal (or the inferred one), if any.
  --drop-below <0-1>         Relevance floor below which an entry is dropped.      (default ${DEFAULT_POLICY.dropBelow})
  --summarize-below <0-1>    Relevance floor below which an entry is summarized.   (default ${DEFAULT_POLICY.summarizeBelow})
  --json                     Print machine-readable JSON instead of the report.
  --help                     Show this help.
  --version                  Print the installed version.

${pc.bold('Transcript formats (auto-detected)')}
  ctxjev's own:  { "goal": "...", "entries": [{ "id", "role", "toolName"?, "content", "timestamp" }] }
  Claude Code:   a real session .jsonl (transcript_path, or ~/.claude/projects/*/*.jsonl) — the
                 goal is inferred from your most recent chat message unless --goal overrides it.
  See examples/sample-transcripts in the ctxjev repo for one of each.
`

function fail(message: string): never {
  console.error(`${pc.red('✖')} ${message}`)
  process.exit(1)
}

function failAll(messages: string[]): never {
  for (const message of messages) console.error(`${pc.red('✖')} ${message}`)
  process.exit(1)
}

async function runAnalyze(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      goal: { type: 'string' },
      'drop-below': { type: 'string' },
      'summarize-below': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  })

  const [file] = positionals
  if (!file) fail('missing <transcript.json> — see `ctxjev --help`')

  // Both checked up front, independently — a user missing the key AND pointing at a bad path
  // should hear about both in one run, not fix one only to discover the other on the next try.
  const problems: string[] = []
  if (!process.env.TYPESAFE_API_KEY) {
    problems.push('TYPESAFE_API_KEY is not set — get one at console.typesafe.ai/settings/keys')
  }

  let raw: string | undefined
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    problems.push(`couldn't read ${file}`)
  }

  if (problems.length > 0) failAll(problems)

  const transcript = parseTranscript(raw!)
  const goal = values.goal ?? transcript.goal
  if (!goal) fail('no goal — pass --goal or set "goal" in the transcript file')

  const policy: PruningPolicy = {
    dropBelow: values['drop-below'] ? Number(values['drop-below']) : DEFAULT_POLICY.dropBelow,
    summarizeBelow: values['summarize-below'] ? Number(values['summarize-below']) : DEFAULT_POLICY.summarizeBelow,
    recencyWeight: DEFAULT_POLICY.recencyWeight,
  }

  const usage: JevUsage = { inputTokens: 0, outputTokens: 0 }
  const decisions = await pruneContext(transcript.entries, goal, policy, {
    onUsage: (chunkUsage) => {
      usage.inputTokens += chunkUsage.inputTokens
      usage.outputTokens += chunkUsage.outputTokens
    },
  })
  const savings = summarizeSavings(transcript.entries, decisions)

  if (values.json) {
    console.log(JSON.stringify({ decisions, savings, usage }, null, 2))
    return
  }

  console.log(formatReport(transcript.entries, decisions, savings, usage))
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

  fail(`unknown command "${command}" — see \`ctxjev --help\``)
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err))
})
