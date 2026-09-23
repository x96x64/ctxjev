#!/usr/bin/env node
/**
 * Writes hand-made labels and probes into an eval session. The spec file lists the relevant entry
 * ids (everything else is labeled irrelevant) and probes as { fact, question, entryIds }; ids can
 * be written as unique prefixes of a tool call's id (`tool:toolu_01KNS`) for readability.
 * Refuses a spec that names an unknown id, an ambiguous prefix, or a probe entry not labeled
 * relevant.
 *
 * Usage: node eval/label-session.mjs <session.json> <spec.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { messagesToEntries } from '../dist/index.js'

const [sessionPath, specPath] = process.argv.slice(2)
const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const ids = messagesToEntries(session.messages).map((e) => e.id)

function resolve(ref) {
  const matches = ids.filter((id) => id === ref || id.startsWith(ref))
  if (matches.length !== 1) throw new Error(`"${ref}" matches ${matches.length} entries`)
  return matches[0]
}

const relevant = new Set(spec.relevant.map(resolve))
session.labels = Object.fromEntries(ids.map((id) => [id, relevant.has(id)]))
session.probes = spec.probes.map((p) => {
  const entryIds = p.entryIds.map(resolve)
  for (const id of entryIds) if (!relevant.has(id)) throw new Error(`probe "${p.fact}" cites ${id}, which isn't labeled relevant`)
  return { fact: p.fact, question: p.question, entryIds }
})
writeFileSync(sessionPath, `${JSON.stringify(session, null, 1)}\n`)
console.log(`${sessionPath}: ${relevant.size}/${ids.length} relevant, ${session.probes.length} probes`)
