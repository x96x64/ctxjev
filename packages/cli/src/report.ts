import pc from 'picocolors'
import { truncate, type Entry, type JevUsage, type PruneDecision, type SavingsReport } from 'ctxjev-core'
import { estimateCostUsd } from './cost.js'

const ACTION_COLOR: Record<PruneDecision['action'], (s: string) => string> = {
  keep: pc.green,
  summarize: pc.yellow,
  drop: pc.red,
}
const ACTION_WIDTH = Math.max(...Object.keys(ACTION_COLOR).map((a) => a.length))

/** A plain loop, not Math.max(...widths) — entries comes straight from a real (unbounded)
 * transcript, and spreading a large enough array into a function call risks a stack-size
 * RangeError, the same risk ctxjev-core's computeRecency was fixed to avoid. */
function maxLength(values: string[], floor: number): number {
  let max = floor
  for (const v of values) if (v.length > max) max = v.length
  return max
}

export function formatReport(
  entries: Entry[],
  decisions: PruneDecision[],
  savings: SavingsReport,
  usage: JevUsage,
  scorer: 'jev' | 'local' | 'recency' = 'recency',
): string {
  const decisionByEntryId = new Map(decisions.map((d) => [d.entryId, d]))
  const lines: string[] = []

  lines.push(
    pc.dim(
      `score: 0–1, higher = more relevant to your goal · ${pc.green('keep')} = as-is, ${pc.yellow('summarize')} = shorten, ${pc.red('drop')} = remove`,
    ),
  )
  lines.push('')

  const idWidth = maxLength(entries.map((e) => e.id), 2)
  const roleWidth = maxLength(entries.map((e) => e.toolName ?? e.role), 4)

  for (const entry of entries) {
    const decision = decisionByEntryId.get(entry.id)
    if (!decision) continue

    const id = entry.id.padEnd(idWidth)
    const role = (entry.toolName ?? entry.role).padEnd(roleWidth)
    const score = decision.combinedScore.toFixed(2)
    const action = ACTION_COLOR[decision.action](decision.action.padEnd(ACTION_WIDTH))

    lines.push(`  ${pc.dim(id)}  ${role}  ${action}  ${pc.dim(`score ${score}`)}  ${truncate(entry.content, 60)}`)
  }

  lines.push('')
  lines.push(
    `${pc.bold(String(savings.keptEntries))} kept, ` +
      `${pc.bold(String(savings.summarizedEntries))} summarized, ` +
      `${pc.bold(String(savings.droppedEntries))} dropped ` +
      `${pc.dim(`(of ${savings.totalEntries} entries)`)}`,
  )

  const droppedPct = savings.totalTokens === 0 ? 0 : Math.round((savings.droppedTokens / savings.totalTokens) * 100)
  const summarizable =
    savings.summarizableTokens > 0 ? `, plus ~${savings.summarizableTokens.toLocaleString()} in entries marked summarize (savings there depend on your summarizer)` : ''
  lines.push(
    pc.dim(`~${savings.droppedTokens.toLocaleString()} / ${savings.totalTokens.toLocaleString()} tokens saved by dropping (${droppedPct}%)${summarizable}`),
  )

  if (scorer === 'local') {
    lines.push(pc.dim('Scored offline by keyword overlap — no Jev call, nothing sent. Much cruder than Jev; treat the decisions as a rough guide.'))
    return lines.join('\n')
  }
  if (scorer === 'recency') {
    lines.push(pc.dim('Scored by position alone (newest kept, like plain truncation) — no Jev call, nothing sent.'))
    return lines.join('\n')
  }

  const costUsd = estimateCostUsd(usage)
  lines.push(
    pc.dim(
      `Jev cost: ${usage.inputTokens.toLocaleString()} input tokens, ${usage.outputTokens.toLocaleString()} output tokens (free) — ~$${costUsd.toFixed(6)}`,
    ),
  )

  return lines.join('\n')
}
