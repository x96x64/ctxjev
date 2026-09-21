#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import pc from 'picocolors'
import { DEFAULT_POLICY, pruneContext, summarizeSavings, type PruningPolicy } from 'ctxjev-core'
import { formatReport } from './report.js'
import { parseTranscript } from './transcript.js'

const VERSION = '0.0.0'

const HELP = `${pc.bold('ctxjev')} — score and prune AI agent context with Jev

${pc.bold('Usage')}
  ctxjev analyze <transcript.json> --goal "<current task>" [options]

${pc.bold('Options')}
  --goal <text>              Overrides the transcript file's own "goal", if any.
  --drop-below <0-1>         Relevance floor below which an entry is dropped.      (default ${DEFAULT_POLICY.dropBelow})
  --summarize-below <0-1>    Relevance floor below which an entry is summarized.   (default ${DEFAULT_POLICY.summarizeBelow})
  --json                     Print machine-readable JSON instead of the report.
  --help                     Show this help.
  --version                  Print the installed version.

${pc.bold('Transcript format')}
  { "goal": "...", "entries": [{ "id", "role", "toolName"?, "content", "timestamp" }] }
  See examples/sample-transcripts in the ctxjev repo for a real one.
`

function fail(message: string): never {
  console.error(`${pc.red('✖')} ${message}`)
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

  if (!process.env.TYPESAFE_API_KEY) {
    fail('TYPESAFE_API_KEY is not set — get one at console.typesafe.ai/settings/keys')
  }

  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    fail(`couldn't read ${file}`)
  }

  const transcript = parseTranscript(raw)
  const goal = values.goal ?? transcript.goal
  if (!goal) fail('no goal — pass --goal or set "goal" in the transcript file')

  const policy: PruningPolicy = {
    dropBelow: values['drop-below'] ? Number(values['drop-below']) : DEFAULT_POLICY.dropBelow,
    summarizeBelow: values['summarize-below'] ? Number(values['summarize-below']) : DEFAULT_POLICY.summarizeBelow,
    recencyWeight: DEFAULT_POLICY.recencyWeight,
  }

  const decisions = await pruneContext(transcript.entries, goal, policy)
  const savings = summarizeSavings(transcript.entries, decisions)

  if (values.json) {
    console.log(JSON.stringify({ decisions, savings }, null, 2))
    return
  }

  console.log(formatReport(transcript.entries, decisions, savings))
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
