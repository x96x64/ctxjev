import pc from 'picocolors'
import type { Entry, JevUsage, PruneDecision, SavingsReport } from 'ctxjev-core'
import { estimateCostUsd } from './cost.js'

const ACTION_COLOR: Record<PruneDecision['action'], (s: string) => string> = {
  keep: pc.green,
  summarize: pc.yellow,
  drop: pc.red,
}
const ACTION_WIDTH = Math.max(...Object.keys(ACTION_COLOR).map((a) => a.length))

function truncate(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

export function formatReport(entries: Entry[], decisions: PruneDecision[], savings: SavingsReport, usage: JevUsage): string {
  const decisionByEntryId = new Map(decisions.map((d) => [d.entryId, d]))
  const lines: string[] = []

  lines.push(
    pc.dim(
      `score: 0–1, higher = more relevant to your goal · ${pc.green('keep')} = as-is, ${pc.yellow('summarize')} = shorten, ${pc.red('drop')} = remove`,
    ),
  )
  lines.push('')

  const idWidth = Math.max(2, ...entries.map((e) => e.id.length))
  const roleWidth = Math.max(4, ...entries.map((e) => (e.toolName ?? e.role).length))

  for (const entry of entries) {
    const decision = decisionByEntryId.get(entry.id)
    if (!decision) continue

    const id = entry.id.padEnd(idWidth)
    const role = (entry.toolName ?? entry.role).padEnd(roleWidth)
    const score = decision.combinedScore.toFixed(2)
    const action = ACTION_COLOR[decision.action](decision.action.padEnd(ACTION_WIDTH))

    lines.push(`  ${pc.dim(id)}  ${role}  ${action}  ${pc.dim(`score ${score}`)}  ${truncate(entry.content)}`)
  }

  lines.push('')
  lines.push(
    `${pc.bold(String(savings.keptEntries))} kept, ` +
      `${pc.bold(String(savings.summarizedEntries))} summarized, ` +
      `${pc.bold(String(savings.droppedEntries))} dropped ` +
      `${pc.dim(`(of ${savings.totalEntries} entries)`)}`,
  )

  const savedPct = savings.totalTokens === 0 ? 0 : Math.round((savings.savedTokens / savings.totalTokens) * 100)
  lines.push(
    pc.dim(
      `~${savings.savedTokens.toLocaleString()} / ${savings.totalTokens.toLocaleString()} tokens saved (${savedPct}%)`,
    ),
  )

  const costUsd = estimateCostUsd(usage)
  lines.push(
    pc.dim(
      `Jev cost: ${usage.inputTokens.toLocaleString()} input tokens, ${usage.outputTokens.toLocaleString()} output tokens (free) — ~$${costUsd.toFixed(6)}`,
    ),
  )

  return lines.join('\n')
}
