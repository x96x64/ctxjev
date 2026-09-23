import { readFileSync, writeFileSync } from 'node:fs'

export function loadEvents(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

export function saveEvents(path, events) {
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}
