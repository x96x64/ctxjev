/**
 * The blind secret-masking corpus in test/blind-redact/ (see the README there), and the measures
 * shared by src/redactBlind.test.ts (dev half only) and scripts/redact-blind.ts. Fixed before
 * anything was measured:
 * - a line with secrets is detected when, for every secret on it, no piece of it min(8, its length)
 *   characters long is left in the output, other than a piece that also appears in the line away
 *   from the secrets; "verbatim" is the looser measure, no secret left whole;
 * - a harmless line is a false positive when the output differs from it in any way.
 */
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'

export type BlindItem = { id: string; kind: 'secret' | 'benign'; context: string; text: string; secrets: string[]; note: string }

export function loadBlindHalf(half: 'dev' | 'holdout'): BlindItem[] {
  const encoded = readFileSync(new URL(`./blind-redact/${half}.json.b64`, import.meta.url), 'utf8')
  return JSON.parse(Buffer.from(encoded.replace(/\s+/g, ''), 'base64').toString('utf8'))
}

export function leakOf(item: Pick<BlindItem, 'text' | 'secrets'>, output: string): { strict: boolean; verbatim: boolean } {
  let away = item.text
  for (const secret of [...item.secrets].sort((a, b) => b.length - a.length)) away = away.split(secret).join('\u0000')
  let strict = false
  let verbatim = false
  for (const secret of item.secrets) {
    if (output.includes(secret)) verbatim = true
    const size = Math.min(8, secret.length)
    for (let i = 0; i + size <= secret.length; i++) {
      const piece = secret.slice(i, i + size)
      if (output.includes(piece) && !away.includes(piece)) strict = true
    }
  }
  return { strict: strict || verbatim, verbatim }
}
