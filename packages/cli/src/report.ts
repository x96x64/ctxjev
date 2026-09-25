import pc from 'picocolors'
import { truncate, type Entry, type JevUsage, type KeptDrops, type PruneDecision, type SavingsReport } from 'ctxjev-core'
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

// What "score" means depends on the scorer: under recency it's position, not relevance at all.
const SCORE_LEGEND: Record<'jev' | 'local' | 'recency', string> = {
  recency: 'score: 0–1, position in the transcript (oldest 0, newest 1), not relevance: the goal isn\'t used',
  local: 'score: 0–1, how much an entry shares your goal\'s words, ranked within this transcript, blended with recency',
  jev: 'score: 0–1, Jev\'s judgment of relevance to your goal, blended with recency',
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

  lines.push(pc.dim(`${SCORE_LEGEND[scorer]} · ${pc.green('keep')} = as-is, ${pc.yellow('summarize')} = shorten, ${pc.red('drop')} = remove`))
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
  // Only ever a saving: nothing to drop reads as that, never as "~0" or a negative number saved.
  lines.push(
    pc.dim(
      savings.droppedTokens > 0
        ? `~${savings.droppedTokens.toLocaleString()} / ${savings.totalTokens.toLocaleString()} tokens saved by dropping (${droppedPct}%)${summarizable}`
        : `no tokens saved by dropping (of ${savings.totalTokens.toLocaleString()})${summarizable}`,
    ),
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

/**
 * Why `prune` kept entries the policy marked `drop`, each reason counted separately; undefined when
 * every drop was removed. Only what really is protected is called "protected": the rest were left
 * because the change as a whole wasn't worth making.
 */
export function describeKeptDrops(kept: KeptDrops, protectLast: number): string | undefined {
  const reasons: Array<[number, string]> = [
    [kept.firstMessage.length, 'protected as the first message'],
    [kept.latestTurn.length, 'protected as part of the latest turn'],
    [kept.lastMessages.length, `protected in the last ${protectLast === 1 ? 'message' : `${protectLast} messages`}`],
    [kept.userText.length, 'protected as your own text'],
    [kept.noNetSaving.length, 'not removed, since removing them would save no tokens once the removal note is counted'],
    [kept.belowMinSaved.length, 'held back by --min-saved-tokens'],
  ]
  const total = reasons.reduce((sum, [n]) => sum + n, 0)
  if (total === 0) return undefined
  return `${total} marked drop but kept: ${reasons
    .filter(([n]) => n > 0)
    .map(([n, why]) => `${n} ${why}`)
    .join('; ')}`
}
