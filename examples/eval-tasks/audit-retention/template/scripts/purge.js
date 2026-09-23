#!/usr/bin/env node
// Nightly purge. Dry run unless --apply is passed (signed off by legal, 2026-06).
import { loadEvents, saveEvents } from '../src/store.js'
import { selectForPurge } from '../src/retention.js'

const [path, flag] = process.argv.slice(2)
const apply = flag === '--apply'
const events = loadEvents(path)
const doomed = new Set(selectForPurge(events).map((e) => e.id))
console.log(`${apply ? 'purging' : 'would purge'} ${doomed.size} of ${events.length} events`)
if (apply) saveEvents(path, events.filter((e) => !doomed.has(e.id)))
