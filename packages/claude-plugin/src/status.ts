#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseClaudeCodeTranscript, resolveClaudeCodeGoal, truncate } from 'ctxjev-core'
import { readLastRun } from './lastRun.js'
import { readPreservedContext } from './preserve.js'
import { sessionKey } from './stateDir.js'

/**
 * `/ctxjev:status`: what the last PreCompact run in this session did, the goal the next one will
 * use, and what's preserved. Run by the skill as `node status.js <session id>`. Reads local files
 * only; nothing is scored or sent.
 */
export async function statusReport(cwd: string, sessionId: string | undefined): Promise<string> {
  const lines = [`ctxjev status — session ${sessionId ?? '(unknown)'}`]

  const transcript = sessionId ? await findTranscript(sessionId) : undefined
  if (transcript) {
    const resolved = resolveClaudeCodeGoal(transcript, parseClaudeCodeTranscript(transcript))
    lines.push(
      resolved
        ? `Goal: ${resolved.goal} (${resolved.source === 'explicit' ? 'set with /ctxjev:set-goal' : 'inferred from your first request and latest instruction'})`
        : 'Goal: none yet — no chat message to infer one from.',
    )
  } else {
    lines.push("Goal: unknown — couldn't find this session's transcript.")
  }

  const lastRun = await readLastRun(cwd, sessionId)
  if (!lastRun) {
    lines.push('Last run: no compaction in this session since the plugin was installed.')
    return lines.join('\n')
  }
  const scorer = lastRun.scorer === 'local' ? 'offline keyword overlap' : lastRun.scorer === 'jev' ? 'Jev' : undefined
  lines.push(`Last run: ${lastRun.at}, ${lastRun.outcome}${lastRun.preserved ? ` (${lastRun.preserved} entries)` : ''}${scorer ? `, scored with ${scorer}` : ''}`)
  if (lastRun.reason) lines.push(`  Reason: ${lastRun.reason}`)
  if (lastRun.note) lines.push(`  Note: ${lastRun.note}`)
  if (lastRun.goal) lines.push(`  Scored against: ${truncate(lastRun.goal, 200)}`)

  const preserved = await readPreservedContext(cwd, sessionId)
  if (preserved && preserved.entries.length > 0) {
    lines.push('Preserved (highest score first):')
    for (const e of [...preserved.entries].sort((a, b) => b.combinedScore - a.combinedScore)) {
      lines.push(`  ${e.combinedScore.toFixed(2)}  ${truncate(e.content, 120)}`)
    }
  }
  return lines.join('\n')
}

// Claude Code keeps each session's log at <config dir>/projects/<project>/<session id>.jsonl.
async function findTranscript(sessionId: string): Promise<string | undefined> {
  if (sessionKey(sessionId, '') !== sessionId) return undefined
  const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  let dirs: string[]
  try {
    dirs = await readdir(projects)
  } catch {
    return undefined
  }
  for (const dir of dirs) {
    try {
      return await readFile(join(projects, dir, `${sessionId}.jsonl`), 'utf8')
    } catch {
      // not this project
    }
  }
  return undefined
}

if (process.argv[1]?.endsWith('status.js')) {
  const sessionId = process.argv[2]?.trim() || undefined
  statusReport(process.cwd(), sessionId)
    .then((report) => console.log(report))
    .catch((err: unknown) => {
      console.error('ctxjev status:', err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    })
}
