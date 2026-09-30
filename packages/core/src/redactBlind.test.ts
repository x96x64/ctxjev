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

// Round 4's corpus (test/blind-redact-2/README.md), written after Round 3's holdout half was used up.
// Its dev half was used while fixing the fourth audit's findings, so this too is a regression check,
// not evidence; its holdout half is never read by a test.
const KNOWN_MISSES_2 = new Set([
  's021', // fish's `set -gx NAME value`, under a name (a VPN's PSK) that doesn't say it's a credential
  's107', // `snyk auth <uuid>`: a bare UUID after a CLI verb
  's168', // a password after a German word in prose, with no `=` or `:`
  's169', // a token after a French phrase in prose
  's179', // a Terraform plan's `"old" -> "new"`: the new value after the arrow
  's183', // a password printed alone on its own line by `vault kv get -field=password`
])
const KNOWN_ALTERED_2 = new Set([
  'b055', // an AWS Secrets Manager ARN's `:secret:<name>` read as a credential's value
])

describe('redactSecrets: the Round 4 blind corpus, dev half', () => {
  const items = loadBlindHalf('dev', 'blind-redact-2')

  it('masks every line with a secret except the known misses', () => {
    const missed = items.filter((i) => i.kind === 'secret' && leakOf(i, redactSecrets(i.text)).strict).map((i) => i.id)
    expect(missed.sort()).toEqual([...KNOWN_MISSES_2].sort())
  })

  it('leaves every harmless line exactly as it was, except the known ones', () => {
    const altered = items.filter((i) => i.kind === 'benign' && redactSecrets(i.text) !== i.text).map((i) => i.id)
    expect(altered.sort()).toEqual([...KNOWN_ALTERED_2].sort())
  })
})

// Round 5's corpus (test/blind-redact-3/README.md), written after Round 4's holdout half was used up.
// Its dev half was used while fixing the fifth audit's findings, so this too is a regression check,
// not evidence; its holdout half is never read by a test.
const KNOWN_MISSES_3 = new Set([
  's075', // an API key after an Italian phrase in prose ("… è <key>"), with no `=` or `:`
  's222', // `snyk auth <uuid>`: a bare UUID after a CLI verb
])

describe('redactSecrets: the Round 5 blind corpus, dev half', () => {
  const items = loadBlindHalf('dev', 'blind-redact-3')

  it('masks every line with a secret except the known misses', () => {
    const missed = items.filter((i) => i.kind === 'secret' && leakOf(i, redactSecrets(i.text)).strict).map((i) => i.id)
    expect(missed.sort()).toEqual([...KNOWN_MISSES_3].sort())
  })

  it('leaves every harmless line exactly as it was', () => {
    const altered = items.filter((i) => i.kind === 'benign' && redactSecrets(i.text) !== i.text).map((i) => i.id)
    expect(altered).toEqual([])
  })
})
