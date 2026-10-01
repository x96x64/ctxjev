import pc from 'picocolors'
import { truncate, type Entry, type EntryKeptDrops, type JevUsage, type KeptDrops, type PruneDecision, type PruneEntriesResult, type PruneMessagesResult, type SavingsReport } from 'ctxjev-core'
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

/**
 * What `prune` does with the transcript `analyze` just scored, so the report never claims a saving
 * `prune` wouldn't make: ctxjev's own format goes through `pruneEntries()` and an Anthropic
 * Messages conversation through `pruneMessages()`, each with the same settings; a Claude Code
 * transcript can't be written back at all.
 */
export type PruneOutcome =
  /** Without `result`, every entry marked drop is taken as removed (nothing protected). */
  | { format: 'entries'; result?: PruneEntriesResult; protectLast?: number }
  | { format: 'claude-code' }
  | { format: 'anthropic-messages'; result: PruneMessagesResult; protectLast: number }

export function formatReport(
  entries: Entry[],
  decisions: PruneDecision[],
  savings: SavingsReport,
  usage: JevUsage,
  scorer: 'jev' | 'local' | 'recency' = 'recency',
  outcome: PruneOutcome = { format: 'entries' },
): string {
  const decisionByEntryId = new Map(decisions.map((d) => [d.entryId, d]))
  const lines: string[] = []

  lines.push(pc.dim(`${SCORE_LEGEND[scorer]} · ${pc.green('keep')} = leave as-is, ${pc.yellow('summarize')} = worth shortening, ${pc.red('drop')} = worth removing`))
  lines.push('')

  const idWidth = maxLength(entries.map((e) => e.id), 2)
  const roleWidth = maxLength(entries.map((e) => e.toolName ?? e.role), 4)

  for (const entry of entries) {
    const decision = decisionByEntryId.get(entry.id)
    if (!decision) continue

    const id = entry.id.padEnd(idWidth)
    const role = (entry.toolName ?? entry.role).padEnd(roleWidth)
    const score = decision.tied ? 'tied' : decision.combinedScore.toFixed(2)
    const action = ACTION_COLOR[decision.action](decision.action.padEnd(ACTION_WIDTH))

    lines.push(`  ${pc.dim(id)}  ${role}  ${action}  ${pc.dim(`score ${score}`)}  ${truncate(entry.content, 60)}`)
  }

  lines.push('')
  // The verdicts, in the words the table uses: nothing has been kept, shortened, or removed yet.
  lines.push(
    `${pc.bold(String(savings.keptEntries))} keep, ` +
      `${pc.bold(String(savings.summarizedEntries))} summarize, ` +
      `${pc.bold(String(savings.droppedEntries))} drop ` +
      `${pc.dim(`(of ${savings.totalEntries} entries)`)}`,
  )
  lines.push(pc.dim(describeOutcome(savings, outcome)))

  if (scorer === 'local') {
    if (decisions.length > 1 && decisions.every((d) => d.tied)) {
      const overlap = Math.round(decisions[0].relevance * 100)
      lines.push(pc.dim(`every entry shares the same keyword overlap with the goal (${overlap === 0 ? 'none' : `${overlap}% of its words`}), so it can't rank them: they're scored by position alone`))
    }
    lines.push(pc.dim('Scored offline by keyword overlap — no Jev call, nothing sent. Much cruder than Jev; treat the decisions as a rough guide.'))
    return lines.join('\n')
  }
  if (scorer === 'recency') {
    lines.push(pc.dim('Scored by position alone (newest kept, like plain truncation) — no Jev call, nothing sent.'))
    return lines.join('\n')
  }
  lines.push(pc.dim(jevCostLine(usage)))
  return lines.join('\n')
}

/** The one line both commands print for a Jev run: the usage Jev's API reported, at its published price. */
export function jevCostLine(usage: JevUsage): string {
  return `Jev cost: ${usage.inputTokens.toLocaleString()} input tokens, ${usage.outputTokens.toLocaleString()} output tokens (free) — ~$${estimateCostUsd(usage).toFixed(6)}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function describeOutcome(savings: SavingsReport, outcome: PruneOutcome): string {
  if (outcome.format === 'anthropic-messages') return formatMessagesOutcome(savings.totalEntries, outcome.result, outcome.protectLast, 'would')
  const share = savings.totalTokens === 0 ? 0 : Math.round((savings.droppedTokens / savings.totalTokens) * 100)
  const dropped = `~${savings.droppedTokens.toLocaleString()} / ${savings.totalTokens.toLocaleString()} tokens`
  if (outcome.format === 'claude-code') {
    const marked = savings.droppedEntries > 0 ? ` (entries marked drop hold ${dropped}, ${share}%)` : ''
    return `prune can't write back a Claude Code transcript, so nothing is removed${marked}`
  }
  // ctxjev's own format: prune removes the entries marked drop that aren't protected, and leaves the
  // rest exactly as it is.
  const summarizable =
    savings.summarizedEntries > 0
      ? `; the ${plural(savings.summarizedEntries, 'entry', 'entries')} marked summarize (~${savings.summarizableTokens.toLocaleString()} tokens) ${savings.summarizedEntries === 1 ? 'stays as it is unless you shorten it' : 'stay as they are unless you shorten them'} yourself`
      : ''
  if (savings.droppedEntries === 0) return `prune would remove nothing, since no entry is marked drop${summarizable}`
  const { result, protectLast = 2 } = outcome
  const kept = result && describeEntryKeptDrops(result.keptDrops, protectLast)
  const keptLine = kept ? `\n${kept}` : ''
  const warning =
    (result?.firstUserEntryRemoved ? `\n${pc.yellow('⚠')} ${firstUserEntryWarning(result.firstUserEntryRemoved, 'would')}` : '') +
    (result?.firstEntryRemovedWithoutUserEntry ? `\n${pc.yellow('⚠')} ${noUserEntryWarning(result.firstEntryRemovedWithoutUserEntry, 'would')}` : '')
  const removedShare = result && savings.totalTokens > 0 ? Math.round((result.savedTokens / savings.totalTokens) * 100) : 0
  const removing =
    !result || result.removed.length === savings.droppedEntries
      ? `prune would remove the ${plural(savings.droppedEntries, 'entry', 'entries')} marked drop, ${dropped} (${share}%)`
      : `prune would remove ${result.removed.length} of the ${plural(savings.droppedEntries, 'entry', 'entries')} marked drop, ~${result.savedTokens.toLocaleString()} / ${savings.totalTokens.toLocaleString()} tokens (${removedShare}%)`
  return `${removing}${summarizable}${keptLine}${warning}`
}

/** What prune did (or would do) with ctxjev's own format: the same numbers either way. */
export function formatEntriesOutcome(total: number, result: PruneEntriesResult, protectLast: number, tense: 'did' | 'would', note = ''): string {
  const kept = describeEntryKeptDrops(result.keptDrops, protectLast)
  return `${tense === 'did' ? 'removed' : 'prune would remove'} ${result.removed.length} of ${total} entries, ~${result.savedTokens.toLocaleString()} tokens${note}${kept ? `\n${kept}` : ''}`
}

/** Issue #20: with no user entry, --protect-first had nothing to protect, and the first entry went unremarked. */
export function noUserEntryWarning(id: string, tense: 'did' | 'would'): string {
  return `${tense === 'did' ? 'removed' : 'would remove'} the first entry (${id}): this transcript has no user entry to protect as the original request`
}

export function firstUserEntryWarning(id: string, tense: 'did' | 'would'): string {
  return `${tense === 'did' ? 'removed' : 'would remove'} the first user entry (${id}), usually the original request (--no-protect-first)`
}

/** Why prune kept entries marked drop in ctxjev's own format; undefined when it removed every one. */
export function describeEntryKeptDrops(kept: EntryKeptDrops, protectLast: number): string | undefined {
  const reasons: Array<[number, string]> = [
    [kept.firstUserEntry.length, 'protected as the first user entry'],
    [kept.lastEntries.length, `protected in the last ${protectLast === 1 ? 'entry' : `${protectLast} entries`}`],
  ]
  const total = reasons.reduce((sum, [n]) => sum + n, 0)
  if (total === 0) return undefined
  return `${total} marked drop but kept: ${reasons
    .filter(([n]) => n > 0)
    .map(([n, why]) => `${n} ${why}`)
    .join('; ')}`
}

/**
 * What `pruneMessages()` did (`prune`) or would do (`analyze`, same settings), from its result: the
 * same numbers either way, so the two commands can't disagree.
 */
export function formatMessagesOutcome(total: number, result: PruneMessagesResult, protectLast: number, tense: 'did' | 'would'): string {
  const did = tense === 'did'
  const kept = describeKeptDrops(result.keptDrops, protectLast)
  const keptLine = kept ? `\n${kept}` : ''
  if (result.heldBack !== undefined) {
    const unchanged = did ? 'left unchanged' : 'prune would leave it unchanged'
    return `${unchanged}: pruning would save only ~${result.heldBack.toLocaleString()} tokens, under --min-saved-tokens${keptLine}`
  }
  const parts = [
    `${did ? 'removed' : 'prune would remove'} ${result.removed.length} of ${total} entries`,
    ...(result.summarized.length > 0 ? [`${did ? 'shortened' : 'shorten'} ${result.summarized.length}`] : []),
    result.savedTokens > 0 ? `~${result.savedTokens.toLocaleString()} tokens saved` : 'no tokens saved',
  ]
  const cache =
    result.cache.firstChangedMessage === null
      ? ''
      : `\nprompt cache: ${did ? '' : 'would be '}rewritten from message ${result.cache.firstChangedMessage} on (~${result.cache.invalidatedTokens.toLocaleString()} tokens on the next request)`
  // Only once something was removed is every unprotected entry gone; otherwise they're all still there.
  const changed = result.removed.length > 0 || result.summarized.length > 0
  const left = changed ? "what's left is protected" : did ? 'nothing was removed (see above)' : 'nothing would be removed (see above)'
  const budget = result.overBudget ? `\n${pc.yellow('⚠')} ${did ? 'still over' : 'would still be over'} --target-tokens: ${left}` : ''
  // The fifth audit: the note was left out without a word when there was nowhere to put it.
  const noNote = result.noteOmitted
    ? `\n${pc.yellow('⚠')} no unprotected user message after the first removal to carry the removal note: the model ${did ? "won't" : "wouldn't"} be told history was removed (a lower --protect-last or --no-protect-last-turn leaves it a place)`
    : ''
  return `${parts.join(', ')}${keptLine}${cache}${budget}${noNote}`
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
