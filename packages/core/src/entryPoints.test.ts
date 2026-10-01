import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import * as main from './index.js'

// 1.0: the main entry point is the stable API (docs/api-stability.md); helpers the other ctxjev
// packages share live in `ctxjev-core/internal`, outside the compatibility promise.
const INTERNAL = [
  'atomicWriteFile',
  'cacheKeyFor',
  'createUsageAccumulator',
  'findExplicitGoal',
  'findOriginalTask',
  'inferGoalFromEntries',
  'isGoalCandidate',
  'isSubstantiveMessage',
  'isValidPolicyOrdering',
  'quoteAsData',
  'rankLocalRelevance',
  'seededRandom',
  'splitCjkBigrams',
  'transcriptStartTime',
  'truncate',
  'validateEntries',
  'validateMessages',
]

describe('entry points', () => {
  it('the main entry exports none of the internal helpers', () => {
    for (const name of INTERNAL) expect(Object.keys(main), name).not.toContain(name)
  })

  it('ctxjev-core/internal exports every one of them', async () => {
    const internal: Record<string, unknown> = await import('./internal.js')
    for (const name of INTERNAL) expect(typeof internal[name], name).toBe('function')
  })

  it('package.json maps both entry points, and nothing else beyond package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './internal', './package.json'])
    expect(pkg.exports['./internal'].default).toBe('./dist/internal.js')
  })

  // An `import`-only map would refuse `require('ctxjev-core')`, which Node's require(esm) support
  // (Node 20.19+, 22.12+) loads from 0.7.2's `main`; only imports by path were meant to go.
  it('resolves both entry points for require() as well as import, and refuses a path into dist/', () => {
    const require = createRequire(import.meta.url)
    expect(require.resolve('ctxjev-core')).toMatch(/[\\/]dist[\\/]index\.js$/)
    expect(require.resolve('ctxjev-core/internal')).toMatch(/[\\/]dist[\\/]internal\.js$/)
    expect(() => require.resolve('ctxjev-core/dist/index.js')).toThrow(/not defined by "exports"/)
  })
})
