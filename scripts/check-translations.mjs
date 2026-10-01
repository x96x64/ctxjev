#!/usr/bin/env node
/**
 * The README's translations against the English README, which is authoritative.
 *
 * Fails if a translation's
 * - fenced code blocks (commands, output, code) aren't byte-identical to the English ones, in order;
 * - generated blocks (`<!-- generated:NAME -->…`, the eval numbers check-docs.mjs checks in English)
 *   aren't identical, in order;
 * - inline code (`--scorer jev`, `ctxjev-core`, …) isn't the same set of spans, each as often;
 * - numbers in prose aren't the same numbers, each as often (a translation can't add a result);
 * - link targets (other than in-page anchors, whose headings are translated) differ;
 * - language switcher line or "translated from English" note is missing.
 * Warns, without failing, if README.md has changed since the translation's recorded source hash
 * (`<!-- translation-source: README.md sha256=… -->`): the translation may be out of date.
 *
 *   node scripts/check-translations.mjs              check every README.<lang>.md
 *   node scripts/check-translations.mjs --write      copy README.md's code blocks and generated blocks
 *                                                    into every translation, in order (prose is left
 *                                                    alone, and so is the recorded source hash)
 *   node scripts/check-translations.mjs --hash       print README.md's current hash, to record
 *   node scripts/check-translations.mjs --selftest   each check catches its own kind of edit
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './readmes.mjs'

export const LANGUAGES = ['en', 'ja', 'zh', 'es', 'ko', 'pt', 'fr', 'de']
const BASE = 'https://github.com/x96x64/ctxjev/blob/main/'
const fileOf = (lang) => (lang === 'en' ? 'README.md' : `README.${lang}.md`)

/** The switcher line every README starts with: its own code in bold, the others linked. */
export function switcher(current) {
  return LANGUAGES.map((lang) => (lang === current ? `**${lang}**` : `[${lang}](${BASE}${fileOf(lang)})`)).join(' | ')
}

/** "Translated from the English README; the English version is authoritative." in each language. */
export const NOTES = {
  ja: '英語版の README から翻訳したものです。内容が食い違う場合は、英語版が正本です。',
  zh: '本文由英文 README 翻译而来（简体中文）。如有出入，以英文版为准。',
  es: 'Traducido del README en inglés. Si hay alguna diferencia, prevalece la versión en inglés.',
  ko: '영어 README를 번역한 문서입니다. 내용이 다를 경우 영어판이 기준입니다.',
  pt: 'Traduzido do README em inglês (português do Brasil). Em caso de diferença, vale a versão em inglês.',
  fr: "Traduit du README anglais. En cas de divergence, c'est la version anglaise qui fait foi.",
  de: 'Aus der englischen README übersetzt. Bei Abweichungen ist die englische Fassung maßgeblich.',
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

const FENCED = /^```[^\n]*\n[\s\S]*?^```$/gm
const GENERATED = /<!-- generated:([\w-]+) -->([\s\S]*?)<!-- \/generated:\1 -->/g
const LINK = /!?\[(?:[^[\]]|\[[^[\]]*\])*\]\(([^)\s]+)\)/g

/** What's comparable between the English README and a translation. */
export function parts(text) {
  const fenced = text.match(FENCED) ?? []
  const generated = [...text.matchAll(GENERATED)].map((m) => m[0])
  const prose = text.replace(FENCED, ' ').replace(GENERATED, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  const inline = (prose.match(/`[^`\n]+`/g) ?? []).sort()
  const links = [...prose.matchAll(LINK)].map((m) => m[1]).filter((t) => !t.startsWith('#')).map((t) => t.replace(/#.*$/, '')).sort()
  const bare = prose
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/\]\([^)\s]+\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
  const numbers = (bare.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, '.')).sort()
  return { fenced, generated, inline, links, numbers }
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
function difference(a, b) {
  const rest = [...b]
  const extra = []
  for (const x of a) {
    const i = rest.indexOf(x)
    if (i === -1) extra.push(x)
    else rest.splice(i, 1)
  }
  return { onlyInFirst: extra, onlyInSecond: rest }
}

/** Problems (failures) and warnings for one translation. */
export function checkTranslation(lang, text, english) {
  const problems = []
  const warnings = []
  // The switcher lines differ by design (each bolds its own language); everything else is compared.
  const en = parts(english.replace(switcher('en'), ''))
  const tr = parts(text.replace(switcher(lang), ''))
  if (!same(en.fenced, tr.fenced)) problems.push(`code blocks differ from README.md's (${tr.fenced.length} here, ${en.fenced.length} in English, or their contents)`)
  if (!same(en.generated, tr.generated)) problems.push("generated blocks differ from README.md's (the eval numbers must be byte-identical)")
  for (const [name, a, b] of [
    ['inline code', en.inline, tr.inline],
    ['link targets', en.links, tr.links],
    ['numbers in prose', en.numbers, tr.numbers],
  ]) {
    const { onlyInFirst, onlyInSecond } = difference(a, b)
    if (onlyInFirst.length > 0) problems.push(`${name} in README.md but not here: ${onlyInFirst.join(', ')}`)
    if (onlyInSecond.length > 0) problems.push(`${name} here but not in README.md: ${onlyInSecond.join(', ')}`)
  }
  if (!text.includes(switcher(lang))) problems.push(`no language switcher line: ${switcher(lang)}`)
  if (!text.includes(NOTES[lang])) problems.push(`no "translated from English" note: ${NOTES[lang]}`)
  const source = /<!-- translation-source: README\.md sha256=([0-9a-f]{64}) -->/.exec(text)
  if (!source) problems.push('no <!-- translation-source: README.md sha256=… --> line')
  else if (source[1] !== sha256(english)) warnings.push('README.md has changed since this translation was made (its recorded source hash differs); check whether it needs updating')
  return { problems, warnings }
}

/** `text` with its fenced code blocks and generated blocks replaced by English's, in order. */
export function syncFromEnglish(text, english) {
  const fenced = english.match(FENCED) ?? []
  const generated = new Map([...english.matchAll(GENERATED)].map((m) => [m[1], m[0]]))
  let i = 0
  const count = (text.match(FENCED) ?? []).length
  if (count !== fenced.length) throw new Error(`${count} code blocks here, ${fenced.length} in README.md: add or remove them by hand first`)
  return text.replace(FENCED, () => fenced[i++]).replace(GENERATED, (whole, name) => generated.get(name) ?? whole)
}

function selftest() {
  const english = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const ja = readFileSync(join(ROOT, 'README.ja.md'), 'utf8')
  const edits = [
    ['a command in a code block', (t) => t.replace('npm install -g ctxjev-cli', 'npm install -g ctxjev')],
    ['a line of real output', (t) => t.replace('3 keep, 2 summarize, 2 drop (of 7 entries)', '3 keep, 2 summarize, 2 drop (of 8 entries)')],
    ['a generated eval number', (t) => t.replace(/(<!-- generated:holdout-retention-jev -->)[^<]*/, '$131.0%')],
    ['a flag in inline code', (t) => t.replace('`--scorer jev`', '`--scorer-jev`')],
    ['a hand-typed number in prose', (t) => t.replace(/\n## /, '\n\n12.5%\n\n## ')],
    ['a link to another file', (t) => t.replace('(docs/evaluation.md)', '(docs/evaluations.md)')],
    ['the switcher line', (t) => t.replace(switcher('ja'), '')],
    ['the authoritative note', (t) => t.replace(NOTES.ja, '')],
  ]
  let ok = true
  for (const [what, edit] of edits) {
    const edited = edit(ja)
    if (edited === ja) {
      console.log(`MISSED: ${what} (the edit didn't apply)`)
      ok = false
      continue
    }
    const caught = checkTranslation('ja', edited, english).problems.length > checkTranslation('ja', ja, english).problems.length
    console.log(`${caught ? 'caught' : 'MISSED'}: ${what}`)
    if (!caught) ok = false
  }
  const stale = checkTranslation('ja', ja, `${english}\nA new paragraph.\n`)
  console.log(`${stale.warnings.length > 0 && stale.problems.length === checkTranslation('ja', ja, english).problems.length ? 'warned' : 'MISSED'}: README.md changed after the translation (a warning, not a failure)`)
  process.exit(ok ? 0 : 1)
}

function main() {
  if (process.argv.includes('--hash')) {
    console.log(sha256(readFileSync(join(ROOT, 'README.md'), 'utf8')))
    return
  }
  if (process.argv.includes('--selftest')) return selftest()
  if (process.argv.includes('--write')) {
    const english = readFileSync(join(ROOT, 'README.md'), 'utf8')
    for (const lang of LANGUAGES.slice(1)) {
      const file = join(ROOT, fileOf(lang))
      const text = readFileSync(file, 'utf8')
      const synced = syncFromEnglish(text, english)
      if (synced !== text) {
        writeFileSync(file, synced)
        console.log(`copied README.md's code and generated blocks into ${fileOf(lang)}`)
      }
    }
  }
  const english = readFileSync(join(ROOT, 'README.md'), 'utf8')
  let failed = false
  if (!english.includes(switcher('en'))) {
    console.error(`README.md: no language switcher line: ${switcher('en')}`)
    failed = true
  }
  for (const lang of LANGUAGES.slice(1)) {
    const file = fileOf(lang)
    if (!existsSync(join(ROOT, file))) {
      console.error(`${file} is missing`)
      failed = true
      continue
    }
    const { problems, warnings } = checkTranslation(lang, readFileSync(join(ROOT, file), 'utf8'), english)
    for (const p of problems) console.error(`${file}: ${p}`)
    // GitHub Actions shows a ::warning:: line as an annotation without failing the job.
    for (const w of warnings) console.log(`${process.env.GITHUB_ACTIONS ? '::warning::' : 'warning: '}${file}: ${w}`)
    if (problems.length > 0) failed = true
    else console.log(`ok    ${file}`)
  }
  if (failed) process.exit(1)
}

if (process.argv[1] && process.argv[1].endsWith('check-translations.mjs')) main()
