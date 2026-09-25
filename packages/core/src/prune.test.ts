import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pruneContext, scoreEntries } from './prune.js'
import type { Entry } from './types.js'

const samples = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/sample-transcripts')
const sample = (name: string) => JSON.parse(readFileSync(join(samples, name), 'utf8')) as { goal: string; entries: Entry[]; groundTruth: Record<string, boolean> }

describe("pruneContext with scorer: 'local'", () => {
  // The second audit ran `ctxjev prune --scorer local` on these three and lost 13 of 14, 8 of 9, and
  // 8 of 11 labeled-relevant entries: raw keyword overlap rarely reaches the 0.3 drop threshold.
  it.each(['pagination-bug.json', 'session-logout.json', 'invoice-date-ja.json'])('no longer drops most labeled-relevant entries of %s', async (name) => {
    const { goal, entries, groundTruth } = sample(name)
    const decisions = await pruneContext(entries, goal, undefined, { scorer: 'local' })
    const relevant = Object.keys(groundTruth).filter((id) => groundTruth[id])
    const lost = decisions.filter((d) => d.action === 'drop' && groundTruth[d.entryId]).length
    expect(lost / relevant.length).toBeLessThan(0.5)
  })

  it("ranks overlap within the batch before the thresholds; scoreEntries still returns the overlap itself", async () => {
    const goal = 'retry charge customer twice payment'
    const words = goal.split(' ')
    // Ten entries sharing 0 to 4 of the goal's five words (0 twice, then 1 … 4 twice each), oldest first.
    const entries: Entry[] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4].map((n, i) => ({ id: `e${i}`, role: 'tool', content: `${words.slice(0, n).join(' ')} unrelated`, timestamp: i }))
    const raw = await scoreEntries(entries, goal, 0, { scorer: 'local' })
    expect(raw.map((s) => s.relevance)).toEqual([0, 0, 0.2, 0.2, 0.4, 0.4, 0.6, 0.6, 0.8, 0.8])

    const decisions = await pruneContext(entries, goal, { dropBelow: 0.3, summarizeBelow: 0.6, recencyWeight: 0 }, { scorer: 'local' })
    // Tie groups take their average rank: (0+1)/2/9, (2+3)/2/9, …
    expect(decisions.map((d) => Number(d.relevance.toFixed(3)))).toEqual([0.056, 0.056, 0.278, 0.278, 0.5, 0.5, 0.722, 0.722, 0.944, 0.944])
    expect(decisions.map((d) => d.action)).toEqual(['drop', 'drop', 'drop', 'drop', 'summarize', 'summarize', 'keep', 'keep', 'keep', 'keep'])
  })

  it('drops nothing when no entry overlaps the goal more than another: there is nothing to rank on', async () => {
    const entries: Entry[] = ['alpha', 'beta', 'gamma'].map((content, i) => ({ id: `e${i}`, role: 'tool', content, timestamp: i }))
    const decisions = await pruneContext(entries, 'something else entirely', undefined, { scorer: 'local' })
    expect(decisions.map((d) => d.action)).toEqual(['keep', 'keep', 'keep'])
  })
})
