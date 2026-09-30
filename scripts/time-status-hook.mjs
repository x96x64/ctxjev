/**
 * How long the Claude Code plugin's UserPromptSubmit hook (packages/claude-plugin/dist/statusHook.js)
 * takes on an ordinary prompt, which is every prompt but `/ctxjev:status`: the median of N runs,
 * next to a bare `node` start for scale. Offline, with a throwaway state directory.
 *
 *   node scripts/time-status-hook.mjs [runs]
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const runs = Number(process.argv[2] ?? 30)
const hook = fileURLToPath(new URL('../packages/claude-plugin/dist/statusHook.js', import.meta.url))
const state = mkdtempSync(join(tmpdir(), 'ctxjev-time-hook-'))
const env = { PATH: process.env.PATH, HOME: process.env.HOME, CTXJEV_STATE_DIR: state }
const input = JSON.stringify({ prompt: 'fix the failing checkout test', cwd: state, session_id: 's1' })

function median(args, stdin) {
  const times = []
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint()
    const { status, stdout } = spawnSync(process.execPath, args, { input: stdin, env })
    times.push(Number(process.hrtime.bigint() - start) / 1e6)
    if (status !== 0 || stdout.length !== 0) throw new Error(`unexpected: exit ${status}, stdout ${JSON.stringify(String(stdout))}`)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length / 2)]
}

median([hook], input) // warm the file cache
const bare = median(['-e', ''], '')
const hookMs = median([hook], input)
rmSync(state, { recursive: true, force: true })
console.log(`node ${process.version}, ${runs} runs each, median: bare node ${bare.toFixed(1)} ms; statusHook.js on an ordinary prompt ${hookMs.toFixed(1)} ms (+${(hookMs - bare).toFixed(1)} ms)`)
