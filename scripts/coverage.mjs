#!/usr/bin/env node
/**
 * Test coverage per package, against a minimum for each, offline (no key, Jev on a closed port).
 * CI runs it; so can you, after `pnpm build`:
 *
 *   node scripts/coverage.mjs
 *
 * Two measures, reported separately because they count differently and can't be added up:
 * - in-process: what the package's own tests ran of its src/, by vitest's v8 coverage (statements,
 *   branches, functions, lines), with the minimums below enforced by vitest;
 * - subprocess: what the tests' subprocesses ran of the built dist/, mapped back to src/ by its
 *   source maps (c8, lines). The CLI's and the MCP server's tests run their dist/ as a user would,
 *   and that code never shows up in-process. The plugin's hooks run as a minified bundle with no
 *   source map, so they aren't measured this way.
 *
 * The third audit (4.5-2) measured 55.95% for the CLI, 64.28% for the MCP server, and 61.7% for the
 * plugin, in-process only, and noted that CI didn't measure coverage at all. The minimums sit a
 * little under what each package measured when they were set, so a drop fails CI.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)

const PACKAGES = {
  core: { inProcess: { statements: 95, branches: 92, functions: 96, lines: 97 }, extraArgs: ['--exclude', 'eval/fixtures/**'] },
  cli: { inProcess: { statements: 50, branches: 37, functions: 50, lines: 52 }, subprocessLines: 75 },
  'mcp-server': { inProcess: { statements: 78, branches: 75, functions: 80, lines: 76 }, subprocessLines: 75 },
  'claude-plugin': { inProcess: { statements: 63, branches: 54, functions: 68, lines: 65 } },
}

const env = { ...process.env, TYPESAFE_BASE_URL: 'http://127.0.0.1:9' }
for (const name of ['TYPESAFE_API_KEY', 'ANTHROPIC_API_KEY', 'CTXJEV_ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']) delete env[name]

const pct = (summary, key) => summary.total[key].pct
const rows = []
let failed = false

for (const [pkg, { inProcess, subprocessLines, extraArgs = [] }] of Object.entries(PACKAGES)) {
  const dir = join(root, 'packages', pkg)
  const work = mkdtempSync(join(tmpdir(), `ctxjev-coverage-${pkg}-`))
  const raw = join(work, 'raw')
  const thresholds = Object.entries(inProcess).map(([k, v]) => `--coverage.thresholds.${k}=${v}`)
  const vitest = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', ...extraArgs, '--coverage.enabled', '--coverage.provider=v8', '--coverage.include=src/**', '--coverage.exclude=src/**/*.test.ts', '--coverage.reporter=json-summary', `--coverage.reportsDirectory=${join(work, 'in')}`, ...thresholds],
    { cwd: dir, env: { ...env, CTXJEV_SUBPROCESS_COVERAGE: raw }, encoding: 'utf8' },
  )
  if (vitest.status !== 0) {
    failed = true
    console.error(`${pkg}: tests or in-process coverage minimums failed\n${vitest.stdout.slice(-3000)}${vitest.stderr.slice(-2000)}`)
  }
  let summary
  try {
    summary = JSON.parse(readFileSync(join(work, 'in', 'coverage-summary.json'), 'utf8'))
  } catch {
    rows.push([pkg, 'in-process', 'no report'])
    rmSync(work, { recursive: true, force: true })
    continue
  }
  rows.push([pkg, 'in-process', ['statements', 'branches', 'functions', 'lines'].map((k) => `${k} ${pct(summary, k)}% (min ${inProcess[k]})`).join(', ')])

  if (subprocessLines !== undefined) {
    const c8 = spawnSync(
      'pnpm',
      ['exec', 'c8', 'report', '--temp-directory', raw, '--reporter', 'json-summary', '--report-dir', join(work, 'sub'), '--include', `packages/${pkg}/src/**`, '--exclude', '**/*.test.ts', '--exclude-after-remap'],
      { cwd: root, env, encoding: 'utf8' },
    )
    let lines
    try {
      lines = pct(JSON.parse(readFileSync(join(work, 'sub', 'coverage-summary.json'), 'utf8')), 'lines')
    } catch {
      lines = undefined
    }
    // With nothing measured, c8 reports the percentage as "Unknown", which `< 75` lets through.
    if (c8.status !== 0 || typeof lines !== 'number' || lines < subprocessLines) {
      failed = true
      console.error(`${pkg}: subprocess coverage ${lines ?? 'missing'}% of lines, minimum ${subprocessLines}%\n${c8.stderr.slice(-2000)}`)
    }
    rows.push([pkg, 'subprocess (dist → src)', `lines ${lines ?? '—'}% (min ${subprocessLines})`])
  }
  rmSync(work, { recursive: true, force: true })
}

for (const [pkg, kind, text] of rows) console.log(`${pkg.padEnd(14)} ${kind.padEnd(24)} ${text}`)
if (failed) process.exitCode = 1
