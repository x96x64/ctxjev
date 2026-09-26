import { describe, expect, it } from 'vitest'
import { leakOf, loadBlindHalf } from '../test/blindCorpus.js'
import { redactSecrets } from './redact.js'

// The dev half of the blind corpus (test/blind-redact/README.md): lines a separate agent wrote
// without seeing redact.ts. It was used while fixing, so it's a regression check, not evidence;
// the holdout half is never read by a test. Every miss that remains is listed here, by id.
const KNOWN_MISSES = new Set([
  's067', // an Algolia admin key passed positionally: algoliasearch('<app id>', '<key>')
  's068', // `snyk auth <uuid>`: a bare UUID after a CLI verb
])

describe('redactSecrets: the blind corpus, dev half', () => {
  const items = loadBlindHalf('dev')

  it('masks every line with a secret except the known misses', () => {
    const missed = items.filter((i) => i.kind === 'secret' && leakOf(i, redactSecrets(i.text)).strict).map((i) => i.id)
    expect(missed.sort()).toEqual([...KNOWN_MISSES].sort())
  })

  it('leaves every harmless line exactly as it was', () => {
    const altered = items.filter((i) => i.kind === 'benign' && redactSecrets(i.text) !== i.text).map((i) => i.id)
    expect(altered).toEqual([])
  })
})
