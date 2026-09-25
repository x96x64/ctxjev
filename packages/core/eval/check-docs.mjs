#!/usr/bin/env node
/**
 * The eval numbers in README.md, PREREGISTRATION.md, the plugin README, and the Japanese docs under
 * docs/, generated from the saved results in eval/results/ and checked against them in CI.
 * Nobody types these numbers by hand.
 *
 * A generated block sits between `<!-- generated:NAME -->` and `<!-- /generated:NAME -->` (inline,
 * or around whole lines); `--write` replaces what's between the markers with what RENDERERS.NAME
 * produces from the saved results, and the default mode fails if anything differs. Every table in
 * README.md's "Does It Work?" section and PREREGISTRATION.md's "Results" section must be inside a
 * generated block, or directly below an `<!-- unverified: reason -->` line saying why it can't be
 * (its raw output was never saved) — so a new table can't slip in unchecked either.
 *
 *   node eval/check-docs.mjs           exit 1, with a diff, if the docs disagree with the saved results
 *   node eval/check-docs.mjs --write   rewrite every generated block from the saved results
 *
 * The statistics are the ones each eval script's --report prints (lib.mjs's bootstrap, which is
 * seeded, so the output is stable).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { messagesToEntries } from '../dist/index.js'
import { bootstrap, rateDifference, successRate } from './lib.mjs'
import { sessionSplit } from './split.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')
const load = (name) => JSON.parse(readFileSync(join(here, 'results', name), 'utf8'))

// --- formatting ---------------------------------------------------------------------------------

const MINUS = '−'
const pct0 = (x) => `${Math.round(x * 100)}%`
const pct1 = (x) => `${(x * 100).toFixed(1)}%`
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${-n}` : '0')
const points0 = (x) => signed(Math.round(x * 100))
const points1 = (x) => {
  const n = Number((x * 100).toFixed(1))
  return n > 0 ? `+${n.toFixed(1)}` : n < 0 ? `${MINUS}${(-n).toFixed(1)}` : '0.0'
}
const interval0 = ([lo, hi]) => `[${points0(lo)}, ${points0(hi)}]`
const interval1 = (lo, hi) => `[${points1(lo)}, ${points1(hi)}]`
const table = (header, rows) => [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
const block = (text) => `\n${text}\n`

// --- statistics, as the eval scripts' --report computes them -------------------------------------

/** Task success of one condition, with its 95% interval resampling tasks (tasks.mjs). */
function taskRate(rows, condition) {
  const rs = rows.filter((r) => r.condition === condition)
  if (rs.length === 0) return undefined
  return { rate: successRate('success')(rs), interval: bootstrap(rs, (r) => r.task, successRate('success')), runs: Math.max(...rs.map((r) => r.run)) + 1 }
}

/** a minus b in task success, same tasks resampled together (tasks.mjs, plugin.mjs). */
function difference(rows, key, isA, isB, clusterOf) {
  const both = rows.filter((r) => isA(r) || isB(r))
  const diff = rateDifference(key, isA, isB)
  return { value: diff(both), interval: bootstrap(both, clusterOf, diff) }
}

const taskDiff = (rows, a, b) => difference(rows, 'success', (r) => r.condition === a, (r) => r.condition === b, (r) => r.task)

// --- renderers ----------------------------------------------------------------------------------

const tasksDev = load('tasks.json')
const tasksSonnet = load('tasks-sonnet.json')
const tasksHoldout = load('tasks-holdout.json')
const tasksHoldoutSonnet = load('tasks-holdout-sonnet.json')
const outcome = load('outcome.json')
const plugin = load('plugin.json')
const retentionDev = load('retention-dev.json')
const retentionHoldout = load('retention-holdout.json')
// The two completed runs of the preregistered plugin comparison, recovered from the archive tags
// (see eval/results/README.md). Both are reported; neither was designated in advance as the run.
const PLUGIN_HOLDOUT_RUNS = [
  ['d8aa0b1', load('plugin-holdout-d8aa0b1.json')],
  ['042cf4c', load('plugin-holdout-042cf4c.json')],
]

const SHIPPED = 'jev+user+marker'
const TRUNCATION = 'recency+user+marker'

function holdoutTaskTable() {
  const haiku = (c) => taskRate(tasksHoldout.rows, c)
  const sonnet = (c) => taskRate(tasksHoldoutSonnet.rows, c)
  const cell = (r, bold = false) => (r ? (bold ? `**${pct0(r.rate)}**` : pct0(r.rate)) : 'not run')
  const runs = haiku(SHIPPED).runs
  return block(
    table(
      [`Task success (${runs} runs/task/model, budget ${tasksHoldout.budget * 100}%)`, 'Claude Haiku 4.5', 'Claude Sonnet 5'],
      [
        ['Everything', cell(haiku('full')), cell(sonnet('full'))],
        ['**Pruned by Jev, as shipped**', cell(haiku(SHIPPED), true), cell(sonnet(SHIPPED), true)],
        ['Pruned by plain truncation, same options', cell(haiku(TRUNCATION)), cell(sonnet(TRUNCATION))],
        ['Goal only', cell(haiku('goal-only')), cell(sonnet('goal-only'))],
      ],
    ),
  )
}

function holdoutTaskDiff() {
  const haiku = taskDiff(tasksHoldout.rows, SHIPPED, TRUNCATION)
  const sonnet = taskDiff(tasksHoldoutSonnet.rows, SHIPPED, TRUNCATION)
  return `**${points0(haiku.value)} points, 95% CI ${interval0(haiku.interval)}** with Claude Haiku 4.5 and **${points0(sonnet.value)} points, 95% CI ${interval0(sonnet.interval)}** with Claude Sonnet 5`
}

const RANKINGS = [
  ['jev', 'Jev'],
  ['recency', 'Plain truncation (newest kept)'],
  ['local', "Keyword overlap (`scorer: 'local'`, offline, free)"],
  ['random', 'Random order (mean of 20 seeds)'],
  ['labels', 'The labels themselves (relevant entries first)'],
]

function holdoutRetention() {
  const r = retentionHoldout
  const at25 = (retention, key) => retention[key][0.25].probes
  const d = r.retentionDifference['0.25']
  const vsRandom = r.exploratory.comparisons.random['0.25']
  const vsLocal = r.exploratory.comparisons.local['0.25']
  const cutVsRecency = r.exploratory.atCut.comparisons.recency['0.25']
  const cutVsRandom = r.exploratory.atCut.comparisons.random['0.25']
  const lines = [
    table(
      [`What survives a 25% budget (ranking alone, no \`keepUserText\`; Jev: mean of ${r.runs} runs)`, 'Whole session (v1, preregistered)', 'Up to the fix request (v2, exploratory here)'],
      RANKINGS.map(([key, label]) => {
        const whole = pct1(at25(r.retention, key))
        return [key === 'jev' ? `**${label}**` : label, key === 'jev' ? `**${whole}**` : whole, pct1(at25(r.exploratory.atCut.retention, key))]
      }),
    ),
    '',
    retentionVerdict(r.retention),
    '',
    `Preregistered measure: Jev minus plain truncation is ${points1(d.probes)} points, 95% CI ${interval1(d.low, d.high)}. ` +
      `Exploratory comparisons on the same measure: Jev minus random order is ${points1(vsRandom.probes)} points ${interval1(vsRandom.low, vsRandom.high)}, and Jev minus keyword overlap ${points1(vsLocal.probes)} ${interval1(vsLocal.low, vsLocal.high)}. ` +
      `Up to the fix request (v2): Jev minus plain truncation is ${points1(cutVsRecency.probes)} points ${interval1(cutVsRecency.low, cutVsRecency.high)}, and Jev minus random order ${points1(cutVsRandom.probes)} ${interval1(cutVsRandom.low, cutVsRandom.high)}.`,
  ]
  return block(lines.join('\n'))
}

/** The plain-language reading of the holdout retention table, whichever way the numbers fall. */
function retentionVerdict(retention) {
  const [jev, random, local] = ['jev', 'random', 'local'].map((key) => retention[key][0.25].probes)
  if (jev < random) {
    return (
      `**On the holdout, Jev kept less of what the tasks needed than a random ordering of the same entries did** (${pct1(jev)} vs. ${pct1(random)})` +
      `${jev < local ? `, and less than keyword overlap (${pct1(local)})` : ''}. It beat plain truncation only because truncation scores 0% on the preregistered measure by construction (see below).`
    )
  }
  return `On the holdout, Jev kept ${pct1(jev)} of what the tasks needed, against ${pct1(random)} for a random ordering and ${pct1(local)} for keyword overlap.`
}

const DEV_TASK_ROWS = [
  ['full', 'Everything'],
  [SHIPPED, '**Pruned to 25% by Jev, as shipped** (keeps user text, marks the gap)', true],
  [TRUNCATION, '**Newest kept, with the same two options**', true],
  ['jev', 'Pruned by Jev ranking alone'],
  ['recency', 'Newest kept (plain truncation)'],
  ['keywords', 'Pruned by keyword overlap'],
  ['goal-only', 'Only the task'],
]

function devTaskTable() {
  return block(
    table(
      ['History given to the agent', 'Tasks passed', '95% CI'],
      DEV_TASK_ROWS.map(([condition, label, bold]) => {
        const r = taskRate(tasksDev.rows, condition)
        const [lo, hi] = r.interval
        return [label, bold ? `**${pct0(r.rate)}**` : pct0(r.rate), `[${Math.round(lo * 100)}, ${Math.round(hi * 100)}]`]
      }),
    ),
  )
}

function devTaskDiff() {
  const d = taskDiff(tasksDev.rows, SHIPPED, TRUNCATION)
  return `${points0(d.value)} points ${interval0(d.interval)}`
}

function devSonnet() {
  const jev = taskRate(tasksSonnet.rows, SHIPPED)
  const truncation = taskRate(tasksSonnet.rows, TRUNCATION)
  const d = taskDiff(tasksSonnet.rows, SHIPPED, TRUNCATION)
  return `Jev as shipped passed ${pct0(jev.rate)}, and truncation with the same options passed ${pct0(truncation.rate)} (${points0(d.value)} points ${interval0(d.interval)})`
}

function outcomeRate(strategy, budget) {
  const rs = outcome.rows.filter((r) => r.strategy === strategy && (budget === undefined || r.budget === budget))
  return rs.filter((r) => r.correct).length / rs.length
}

function outcomeTable() {
  const cell = (strategy, budget, bold) => (bold ? `**${pct0(outcomeRate(strategy, budget))}**` : pct0(outcomeRate(strategy, budget)))
  return block(
    table(
      ['Context', '25% budget', '50% budget'],
      [
        ['Everything', cell('full'), cell('full')],
        ['**Pruned by Jev**', cell('jev', 0.25, true), cell('jev', 0.5, true)],
        ['Plain truncation', cell('recency', 0.25), cell('recency', 0.5)],
        ['Keyword overlap', cell('keywords', 0.25), cell('keywords', 0.5)],
      ],
    ),
  )
}

function outcomeDiff() {
  const d = (other, budget) =>
    difference(
      outcome.rows.filter((r) => r.budget === budget),
      'correct',
      (r) => r.strategy === 'jev',
      (r) => r.strategy === other,
      (r) => r.session,
    )
  const [t25, t50, k25, k50] = [d('recency', 0.25), d('recency', 0.5), d('keywords', 0.25), d('keywords', 0.5)]
  return (
    `Jev minus truncation is ${points0(t25.value)} points ${interval0(t25.interval)} at 25% and ${points0(t50.value)} ${interval0(t50.interval)} at 50%. ` +
    `Jev minus keyword overlap is ${points0(k25.value)} ${interval0(k25.interval)} and ${points0(k50.value)} ${interval0(k50.interval)}`
  )
}

function devRetention() {
  const r = retentionDev.retention
  return (
    `Ranking alone (\`eval/run.mjs\`, the dev sessions, Jev: mean of ${retentionDev.runs} runs) keeps ${pct1(r.jev[0.25].probes)} / ${pct1(r.jev[0.5].probes)} of the facts under a 25% / 50% budget, ` +
    `against ${pct1(r.recency[0.25].probes)} / ${pct1(r.recency[0.5].probes)} for truncation, ${pct1(r.local[0.25].probes)} / ${pct1(r.local[0.5].probes)} for keyword overlap, and ${pct1(r.random[0.25].probes)} / ${pct1(r.random[0.5].probes)} for a random order`
  )
}

const devVsLocal = () => `${pct1(retentionDev.retention.jev[0.25].probes)} vs. ${pct1(retentionDev.retention.local[0.25].probes)} at a 25% budget`

const PLUGIN_ROWS = [
  ['summary', 'Summary alone'],
  ['summary+ctxjev', 'Summary + digest (goal = latest message, as in 0.4.0)'],
  ['summary+ctxjev(task goal)', 'Summary + digest (goal = first request + latest instruction, 0.5.0)'],
]

function pluginTable() {
  const tasks = plugin.rows.filter((r) => r.kind === 'task')
  const qa = plugin.rows.filter((r) => r.kind === 'qa')
  return block(
    table(
      ['After compaction', 'Tasks passed', 'Answers right'],
      PLUGIN_ROWS.map(([condition, label]) => [label, pct0(successRate('success')(tasks.filter((r) => r.condition === condition))), pct0(successRate('correct')(qa.filter((r) => r.condition === condition)))]),
    ),
  )
}

function pluginDiff() {
  const tasks = plugin.rows.filter((r) => r.kind === 'task')
  const d = difference(tasks, 'success', (r) => r.condition === 'summary+ctxjev(task goal)', (r) => r.condition === 'summary', (r) => r.task)
  return `${points0(d.value)} points ${interval0(d.interval)}`
}

// --- the plugin's holdout comparison (two recovered runs) ---------------------------------------

const INFERRED = 'summary+ctxjev'
const SET_GOAL = 'summary+ctxjev(task goal)'

function pluginHoldoutStats(file) {
  const tasks = file.rows.filter((r) => r.kind === 'task')
  const qa = file.rows.filter((r) => r.kind === 'qa')
  const contexts = file.rows.filter((r) => r.kind === 'context')
  const rate = (rows, key, condition) => successRate(key)(rows.filter((r) => r.condition === condition))
  const diff = (rows, key, condition) => difference(rows, key, (r) => r.condition === condition, (r) => r.condition === 'summary', (r) => r.task)
  return {
    taskCount: new Set(tasks.map((r) => r.task)).size,
    runs: file.runs,
    tasks: Object.fromEntries(['summary', INFERRED, SET_GOAL].map((c) => [c, rate(tasks, 'success', c)])),
    answers: Object.fromEntries(['summary', INFERRED, SET_GOAL].map((c) => [c, rate(qa, 'correct', c)])),
    taskDiff: { [INFERRED]: diff(tasks, 'success', INFERRED), [SET_GOAL]: diff(tasks, 'success', SET_GOAL) },
    answerDiff: { [INFERRED]: diff(qa, 'correct', INFERRED), [SET_GOAL]: diff(qa, 'correct', SET_GOAL) },
    jevScored: contexts.filter((r) => r.pluginRun?.scorer === 'jev' && r.taskGoalRun?.scorer === 'jev').length,
    sameGoal: contexts.filter((r) => r.pluginRun?.goal === r.taskGoalRun?.goal).length,
    contexts: contexts.length,
  }
}

const pluginHoldout = PLUGIN_HOLDOUT_RUNS.map(([name, file]) => ({ name, ...pluginHoldoutStats(file) }))
const signedDiff = (d) => `${points0(d.value)} ${interval0(d.interval)}`
// The preregistered plugin rule: the digest has a demonstrated effect only if the tasks-passed
// interval's lower bound is above 0.
const clearsZero = (d) => d.interval[0] > 0

function holdoutPlugin() {
  const header = ['After a simulated compaction (holdout, Claude Haiku 4.5)', ...pluginHoldout.flatMap((r) => [`Run \`${r.name}\`: tasks passed`, 'answers right'])]
  const row = (label, condition) => [label, ...pluginHoldout.flatMap((r) => [pct0(r.tasks[condition]), pct0(r.answers[condition])])]
  const diffRow = (label, condition) => [label, ...pluginHoldout.flatMap((r) => [signedDiff(r.taskDiff[condition]), signedDiff(r.answerDiff[condition])])]
  const anyClears = pluginHoldout.some((r) => clearsZero(r.taskDiff[INFERRED]) || clearsZero(r.taskDiff[SET_GOAL]))
  return block(
    [
      table(header, [
        row('Summary alone', 'summary'),
        row('Summary + digest (goal inferred by the plugin)', INFERRED),
        row('Summary + digest (the same goal, set with `/ctxjev:set-goal`)', SET_GOAL),
        diffRow('Digest (inferred goal) − summary alone, 95% CI', INFERRED),
        diffRow('Digest (set goal) − summary alone, 95% CI', SET_GOAL),
      ]),
      '',
      `${pluginHoldout.map((r) => `Run \`${r.name}\`: ${r.taskCount} tasks × ${r.runs} runs, and the hook scored with Jev in ${r.jevScored} of ${r.contexts}`).join('; ')}. ` +
        `In both runs the two digest conditions scored against the identical goal (${pluginHoldout.map((r) => `${r.sameGoal} of ${r.contexts}`).join(', ')}), so they are the same configuration measured twice (the goal supplied two ways), not two different goals. ` +
        (anyClears
          ? 'At least one tasks-passed interval clears zero.'
          : "**No tasks-passed interval clears zero in either run, so by the preregistered rule the digest has no demonstrated effect on unseen tasks.** Answers right isn't the registered measure; it's shown because the two runs disagree there too."),
    ].join('\n'),
  )
}

/** One line for the plugin READMEs and the design doc: both runs' registered measure. */
function pluginHoldoutInline() {
  return pluginHoldout.map((r) => `run \`${r.name}\` ${signedDiff(r.taskDiff[SET_GOAL])}`).join(', ')
}

function preregPluginRerun() {
  const lines = pluginHoldout.map((r) => {
    const t = (c) => signedDiff(r.taskDiff[c])
    const a = (c) => signedDiff(r.answerDiff[c])
    return [
      `**\`plugin-holdout-${r.name}.json\`** (${r.taskCount} tasks × ${r.runs} runs; hook scored with Jev in ${r.jevScored}/${r.contexts}; same goal in both digest conditions ${r.sameGoal}/${r.contexts}):`,
      '',
      table(
        ['context', 'tasks passed', 'answers right'],
        [
          ['`summary`', pct0(r.tasks.summary), pct0(r.answers.summary)],
          [`\`${INFERRED}\``, pct0(r.tasks[INFERRED]), pct0(r.answers[INFERRED])],
          [`\`${SET_GOAL}\``, pct0(r.tasks[SET_GOAL]), pct0(r.answers[SET_GOAL])],
        ],
      ),
      '',
      `- \`${INFERRED}\` − \`summary\`: tasks passed ${t(INFERRED)} pp, answers right ${a(INFERRED)} pp`,
      `- \`${SET_GOAL}\` − \`summary\`: tasks passed **${t(SET_GOAL)} pp**, answers right ${a(SET_GOAL)} pp`,
    ].join('\n')
  })
  return block(lines.join('\n\n'))
}

function preregPrimaryTable() {
  const cell = (rows, c) => {
    const r = taskRate(rows, c)
    return r ? `${pct0(r.rate)} [${pct0(r.interval[0])}, ${pct0(r.interval[1])}]` : 'not run'
  }
  return block(
    table(
      ['condition', 'Claude Haiku 4.5', 'Claude Sonnet 5'],
      ['full', 'goal-only', SHIPPED, TRUNCATION].map((c) => [`\`${c}\``, cell(tasksHoldout.rows, c), cell(tasksHoldoutSonnet.rows, c)]),
    ),
  )
}

function preregPrimaryDiff() {
  const haiku = taskDiff(tasksHoldout.rows, SHIPPED, TRUNCATION)
  const sonnet = taskDiff(tasksHoldoutSonnet.rows, SHIPPED, TRUNCATION)
  return block(
    [`- Claude Haiku 4.5: **${points0(haiku.value)} pp, 95% CI ${interval0(haiku.interval)}**`, `- Claude Sonnet 5: **${points0(sonnet.value)} pp, 95% CI ${interval0(sonnet.interval)}**`].join('\n'),
  )
}

function preregSecondaryRerun() {
  const r = retentionHoldout
  const d = (b) => r.retentionDifference[b]
  const usage = r.jevUsage
  return block(
    [
      `\`retention-holdout.json\`: commit \`${r.commit.slice(0, 7)}\`${r.uncommittedChanges ? ' with uncommitted changes' : ', clean tree'}, ${r.runs} Jev runs; Jev usage ${usage.requests} requests, ${usage.inputTokens.toLocaleString('en-US')} input tokens (~$${usage.usd.toFixed(3)}).`,
      '',
      table(
        ['run', 'jev − recency at 25%', 'jev − recency at 50%'],
        [['saved re-run', `**${points1(d('0.25').probes)} pp, 95% CI ${interval1(d('0.25').low, d('0.25').high)}**`, `${points1(d('0.5').probes)} pp, 95% CI ${interval1(d('0.5').low, d('0.5').high)}`]],
      ),
      '',
      table(
        ['ranking', 'probes retained at 25%', 'at 50%'],
        RANKINGS.map(([key, label]) => [label, pct1(r.retention[key][0.25].probes), pct1(r.retention[key][0.5].probes)]),
      ),
      '',
      `The 25%-budget interval's lower bound is ${d('0.25').low > 0 ? 'above 0 here too' : 'not above 0 here'}. ` +
        `Jev ${r.retention.jev[0.25].probes < r.retention.random[0.25].probes ? 'retained less than a random ordering' : 'retained at least as much as a random ordering'} ` +
        `(${pct1(r.retention.jev[0.25].probes)} vs. ${pct1(r.retention.random[0.25].probes)}) and ${r.retention.jev[0.25].probes < r.retention.local[0.25].probes ? 'less' : 'at least as much'} than keyword overlap (${pct1(r.retention.local[0.25].probes)}).`,
    ].join('\n'),
  )
}

function preregExploratoryAtCut() {
  const r = retentionHoldout.exploratory.atCut
  const excluded = Object.values(r.excludedProbes).reduce((a, b) => a + b, 0)
  return block(
    [
      table(
        ['ranking', 'probes retained at 25%', 'at 50%'],
        RANKINGS.map(([key, label]) => [label, pct1(r.retention[key][0.25].probes), pct1(r.retention[key][0.5].probes)]),
      ),
      '',
      table(
        ['Jev minus', 'at 25%', 'at 50%'],
        ['recency', 'local', 'random', 'labels'].map((other) => [other, `${points1(r.comparisons[other]['0.25'].probes)} ${interval1(r.comparisons[other]['0.25'].low, r.comparisons[other]['0.25'].high)}`, `${points1(r.comparisons[other]['0.5'].probes)} ${interval1(r.comparisons[other]['0.5'].low, r.comparisons[other]['0.5'].high)}`]),
      ),
      '',
      `Probes left out because only the part after the cut states them: ${excluded}.`,
    ].join('\n'),
  )
}

// --- the Round 2 design proposal (docs/design/round-2-scoring-and-evaluation.md, in Japanese) ----

const PLUGIN_ROWS_JA = { summary: '要約のみ', 'summary+ctxjev(task goal)': '要約＋ダイジェスト（0.5.0 の目標推定）' }

function designTaskSuccess() {
  const row = (label, file) => {
    const jev = taskRate(file.rows, SHIPPED)
    const truncation = taskRate(file.rows, TRUNCATION)
    const d = taskDiff(file.rows, SHIPPED, TRUNCATION)
    const tasks = new Set(file.rows.map((r) => r.task)).size
    return [label, `${tasks} 課題 × ${jev.runs} 回`, pct0(jev.rate), pct0(truncation.rate), `${points0(d.value)} ${interval0(d.interval)}`]
  }
  return block(
    table(
      ['データ（25% 予算、利用者の発言を残し削除箇所に注記）', '規模', 'Jev', '単純な切り捨て', '差（ポイント）[95%CI]'],
      [
        row('dev・Claude Haiku 4.5', tasksDev),
        row('dev・Claude Sonnet 5', tasksSonnet),
        row('ホールドアウト・Claude Haiku 4.5', tasksHoldout),
        row('ホールドアウト・Claude Sonnet 5', tasksHoldoutSonnet),
      ],
    ),
  )
}

function designRetention() {
  const row = (label, retention, budget = 0.25) => [label, ...['jev', 'recency', 'local', 'random', 'labels'].map((k) => pct1(retention[k][budget].probes))]
  return block(
    table(
      ['25% 予算で残った「必要な事実」の割合（順位付けのみ）', 'Jev', '単純な切り捨て', 'キーワード一致', 'ランダム順', 'ラベル順'],
      [
        row(`dev ${Object.keys(retentionDev.perSession).length} セッション・全会話（v1）`, retentionDev.retention),
        row(`dev・修正依頼まで（v2・探索的）`, retentionDev.exploratory.atCut.retention),
        row(`ホールドアウト ${Object.keys(retentionHoldout.perSession).length} セッション・全会話（v1・事前登録の指標）`, retentionHoldout.retention),
        row('ホールドアウト・修正依頼まで（v2・探索的）', retentionHoldout.exploratory.atCut.retention),
      ],
    ),
  )
}

function designRetentionDiffs() {
  const r = retentionHoldout
  const fmt = (c) => `${points1(c.probes)} ${interval1(c.low, c.high)}`
  const d = r.retentionDifference['0.25']
  return block(
    table(
      ['ホールドアウト・25% 予算', 'Jev − 切り捨て', 'Jev − キーワード一致', 'Jev − ランダム順'],
      [
        ['全会話（v1・事前登録の指標）', `${points1(d.probes)} ${interval1(d.low, d.high)}`, fmt(r.exploratory.comparisons.local['0.25']), fmt(r.exploratory.comparisons.random['0.25'])],
        ['修正依頼まで（v2・探索的）', fmt(r.exploratory.atCut.comparisons.recency['0.25']), fmt(r.exploratory.atCut.comparisons.local['0.25']), fmt(r.exploratory.atCut.comparisons.random['0.25'])],
      ],
    ),
  )
}

/** Jev's run-to-run spread in the saved holdout run: the mean over sessions of each run separately. */
function designJevSpread() {
  const sessions = Object.values(retentionHoldout.perSession)
  const perRun = Array.from({ length: retentionHoldout.runs }, (_, run) => sessions.reduce((sum, s) => sum + s.jev[run]['0.25'].probes, 0) / sessions.length)
  return `${perRun.map(pct1).join('、')}（同じコマンド・同じ ${sessions.length} セッションでの ${retentionHoldout.runs} 回）`
}

function designOutcomeAndPlugin() {
  const tasks = plugin.rows.filter((r) => r.kind === 'task')
  const qa = plugin.rows.filter((r) => r.kind === 'qa')
  const pd = difference(tasks, 'success', (r) => r.condition === 'summary+ctxjev(task goal)', (r) => r.condition === 'summary', (r) => r.task)
  const od = difference(
    outcome.rows.filter((r) => r.budget === 0.25),
    'correct',
    (r) => r.strategy === 'jev',
    (r) => r.strategy === 'recency',
    (r) => r.session,
  )
  return block(
    [
      table(
        ['質問応答（dev のみ、25% 予算）', 'Jev', '単純な切り捨て', 'キーワード一致', '全履歴', 'Jev − 切り捨て'],
        [['正答率', pct0(outcomeRate('jev', 0.25)), pct0(outcomeRate('recency', 0.25)), pct0(outcomeRate('keywords', 0.25)), pct0(outcomeRate('full')), `${points0(od.value)} ${interval0(od.interval)}`]],
      ),
      '',
      table(
        ['プラグイン（dev のみ、模擬の圧縮）', '課題成功', '回答正答'],
        Object.entries(PLUGIN_ROWS_JA).map(([condition, label]) => [label, pct0(successRate('success')(tasks.filter((r) => r.condition === condition))), pct0(successRate('correct')(qa.filter((r) => r.condition === condition)))]),
      ),
      '',
      `ダイジェストの効果（課題成功、dev）: ${points0(pd.value)} ${interval0(pd.interval)}。ホールドアウトでの事前登録の比較は2回完了しており（アーカイブから復元、1.3.1 節）、課題成功の差は ${pluginHoldoutInline()} でした。`,
    ].join('\n'),
  )
}

/** The recovered plugin holdout runs, in Japanese, for the design doc. */
function designPluginHoldout() {
  const header = ['模擬の圧縮後（ホールドアウト、Claude Haiku 4.5）', ...pluginHoldout.flatMap((r) => [`実行 \`${r.name}\`：課題成功`, '回答正答'])]
  const row = (label, condition) => [label, ...pluginHoldout.flatMap((r) => [pct0(r.tasks[condition]), pct0(r.answers[condition])])]
  const diffRow = (label, condition) => [label, ...pluginHoldout.flatMap((r) => [signedDiff(r.taskDiff[condition]), signedDiff(r.answerDiff[condition])])]
  return block(
    [
      table(header, [
        row('要約のみ', 'summary'),
        row('要約＋ダイジェスト（プラグインが推定した目標）', INFERRED),
        row('要約＋ダイジェスト（同じ目標を `/ctxjev:set-goal` で指定）', SET_GOAL),
        diffRow('差：ダイジェスト（推定）− 要約のみ［95%CI］', INFERRED),
        diffRow('差：ダイジェスト（指定）− 要約のみ［95%CI］', SET_GOAL),
      ]),
      '',
      `${pluginHoldout.map((r) => `実行 \`${r.name}\`：${r.taskCount} 課題 × ${r.runs} 回、フックが Jev で採点した回数 ${r.jevScored}／${r.contexts}`).join('。')}。` +
        `2つのダイジェスト条件は、両実行とも全回で同じ目標で採点されていました（${pluginHoldout.map((r) => `${r.sameGoal}／${r.contexts}`).join('、')}）。つまり「目標の渡し方が違うだけの同じ設定」を2回ずつ測ったものです。`,
    ].join('\n'),
  )
}

const runHoldoutRecovered = load('run-holdout-fa22e81.json')
const runDevRecovered = load('run-dev-ac67ad5.json')

/** The two recovered retention runs (old run.mjs --json output), in Japanese. */
function designRecoveredRetention() {
  const h = runHoldoutRecovered.retention
  const d = runDevRecovered.retention
  const diff = runHoldoutRecovered.retentionDifference['0.25']
  return (
    `ホールドアウト（v1、25% 予算）で Jev ${pct1(h.jev[0.25].probes)}、ランダム順 ${pct1(h.random[0.25].probes)}、キーワード一致 ${pct1(h.local[0.25].probes)}、切り捨て ${pct1(h.recency[0.25].probes)}` +
    `（Jev − 切り捨て ${points1(diff.probes)} ${interval1(diff.low, diff.high)}）。dev の Jev は ${pct1(d.jev[0.25].probes)}／${pct1(d.jev[0.5].probes)}（25%／50% 予算）`
  )
}

const localCalibration = load('local-calibration-dev.json')

/** eval/calibrate-local.mjs on the dev split, in Japanese, labeled as dev. */
function localCalibrationSummary() {
  const s = localCalibration.summary
  const v = (k) => `関連項目の削除 ${pct1(s[k].relevantDropped)}・全項目の削除 ${pct1(s[k].entriesDropped)}`
  return `dev のみ（${localCalibration.fixtures} 件の会話、既定の閾値、会話ごとの平均）：従来（生の一致度）${v('raw')}、同点を最小順位 ${v('min')}、同点を平均順位 ${v('mid')}。事前に決めた規則で「${localCalibration.chosen === 'mid' ? '平均順位' : '最小順位'}」を採用`
}

/** The preregistered primary endpoint on the holdout, in Japanese. */
function jaHoldoutPrimary() {
  const haiku = taskDiff(tasksHoldout.rows, SHIPPED, TRUNCATION)
  const sonnet = taskDiff(tasksHoldoutSonnet.rows, SHIPPED, TRUNCATION)
  return `Haiku ${points0(haiku.value)} ${interval0(haiku.interval)}、Sonnet ${points0(sonnet.value)} ${interval0(sonnet.interval)}（Jev − 切り捨て、課題成功、ポイント）`
}

// The new holdout's size (design choices, stated here so the estimate below is reproducible).
const PLAN = {
  tasks: 24,
  runs: 3,
  budgets: [0.1, 0.15, 0.25],
  rankedConditions: ['recency', 'random', 'jev', 'hybrid'],
  referenceConditions: ['full', 'goal-only'],
  sonnetConditions: ['recency', 'jev', 'hybrid'], // Sonnet at the primary budget only
  probesPerTask: 7,
  pluginConditions: ['summary', 'summary+ctxjev'],
  realCompactionTasks: 12,
}

function meanCost(rows) {
  const costs = rows.map((r) => r.costUsd).filter((c) => typeof c === 'number')
  return costs.reduce((a, b) => a + b, 0) / costs.length
}

function costEstimates() {
  const haikuRun = meanCost(tasksHoldout.rows)
  const sonnetRun = meanCost(tasksHoldoutSonnet.rows)
  const pluginRow = meanCost(plugin.rows)
  // outcome.json keeps no per-row cost; CLAUDE.md records ~$4 for one run of 102 questions × 8 conditions.
  const qaUsd = 4 / (102 * 8)
  const haikuRuns = PLAN.tasks * PLAN.runs * (PLAN.rankedConditions.length * PLAN.budgets.length + PLAN.referenceConditions.length)
  const sonnetRuns = PLAN.tasks * PLAN.runs * PLAN.sonnetConditions.length
  const qaCount = PLAN.tasks * PLAN.probesPerTask * PLAN.runs * (PLAN.rankedConditions.length * PLAN.budgets.length + PLAN.referenceConditions.length)
  const pluginRows = PLAN.tasks * PLAN.runs * PLAN.pluginConditions.length * (1 + PLAN.probesPerTask)
  // A real-compaction run records a session, compacts it, and finishes the task: taken as three Sonnet agent runs.
  const realRuns = PLAN.realCompactionTasks * PLAN.runs * PLAN.pluginConditions.length
  const jevTokensPerSessionRun = retentionHoldout.jevUsage.inputTokens / (Object.keys(retentionHoldout.perSession).length * retentionHoldout.runs)
  const jevTokens = jevTokensPerSessionRun * PLAN.tasks * PLAN.runs * 3 // retention eval, task eval, and plugin eval each rescore every run
  const rows = [
    ['課題成功（Haiku 4.5）', `${haikuRuns} 回 × $${haikuRun.toFixed(3)}（tasks-holdout.json の1回平均）`, haikuRuns * haikuRun],
    ['課題成功（Sonnet 5、主予算のみ）', `${sonnetRuns} 回 × $${sonnetRun.toFixed(3)}（tasks-holdout-sonnet.json）`, sonnetRuns * sonnetRun],
    ['質問応答（Haiku 回答＋Sonnet 採点）', `${qaCount} 問 × $${qaUsd.toFixed(4)}（CLAUDE.md の「約 $4／816 問」）`, qaCount * qaUsd],
    ['プラグイン（模擬の圧縮）', `${pluginRows} 行 × $${pluginRow.toFixed(3)}（plugin.json の1行平均）`, pluginRows * pluginRow],
    ['本物の Claude Code 圧縮', `${realRuns} 回 × Sonnet 3回分（仮定）`, realRuns * 3 * sonnetRun],
    ['課題作成（仕様だけ渡す別エージェント、8課題）', '1課題 $2 と仮定', 8 * 2],
  ]
  const claudeTotal = rows.reduce((sum, r) => sum + r[2], 0)
  const jevUsd = (jevTokens / 1e6) * 0.042
  return { rows, claudeTotal, jevTokens, jevUsd }
}

// Each paid step's --max-usd: its estimate plus half again, for reruns and failures.
const cap = (usd) => Math.ceil((usd * 1.5) / 5) * 5

function designCost() {
  const { rows, claudeTotal, jevTokens, jevUsd } = costEstimates()
  return block(
    [
      table(
        ['項目', '計算', '見積もり（USD）'],
        [...rows.map(([a, b, c]) => [a, b, `$${c.toFixed(0)}`]), ['**Claude API 合計**', '', `**$${claudeTotal.toFixed(0)}**`], ['Jev（全評価の再採点込み）', `約 ${Math.round(jevTokens / 1e6)}M 入力トークン × $0.042/M`, `$${jevUsd.toFixed(2)}`]],
      ),
      '',
      `再実行や失敗に備え、各コマンドの上限（\`--max-usd\`）は見積もりの 1.5 倍とし（3.4 節のコマンドに反映済み）、合計 $${rows.slice(0, 5).reduce((sum, r) => sum + cap(r[2]), 0)} です（課題作成は別途）。`,
    ].join('\n'),
  )
}

function designCommands() {
  const [haiku, sonnet, qa, plugins, real] = costEstimates().rows.map((r) => cap(r[2]))
  const budgets = PLAN.budgets.join(',')
  const ranked = PLAN.rankedConditions.map((c) => `${c}+user+marker`).join(',')
  return block(
    [
      '```bash',
      '# 0. 基盤の自己検査（API 不要・無料）。すべて実装済み',
      'node examples/eval-tasks/verify.mjs',
      'cd packages/core',
      'node eval/harness-selftest.mjs && node eval/check-sessions.mjs',
      'docker pull node:22-bookworm        # Mac では Docker Desktop が必要（隔離の既定）',
      'node eval/tasks.mjs --selftest --split holdout2',
      '',
      '# 1. 記録と取り込み（課題ごと、Claude のログインを使用）。実装済み',
      'node ../../examples/eval-tasks/record.mjs <task> <workdir>',
      'node eval/import-claude-code.mjs <task> <transcript> <repo>',
      '',
      '# 2. ラベル付け（どの採点方式も実行する前）→ コミット。実装済み（holdout2 はコミット前だと読めない）',
      'node eval/label-session.mjs <session> <spec>',
      '',
      '# 3. 本番（ANTHROPIC_API_KEY と TYPESAFE_API_KEY を設定）',
      `node eval/run.mjs --split holdout2 --runs ${PLAN.runs} --budgets ${budgets} --out eval/results/retention-holdout2.json   # 実装済み（v2 は retentionV2）`,
      `node eval/tasks.mjs --split holdout2 --conditions ${PLAN.referenceConditions.join(',')},${ranked} --budgets ${budgets} --rescore-each-run --runs ${PLAN.runs} --max-usd ${haiku} --out eval/results/tasks-holdout2.json   # --budgets, --rescore-each-run, random/hybrid（2a で実装）`,
      `node eval/tasks.mjs --split holdout2 --conditions ${PLAN.sonnetConditions.map((c) => `${c}+user+marker`).join(',')} --budgets 0.15 --rescore-each-run --runs ${PLAN.runs} --agent-model claude-sonnet-5 --max-usd ${sonnet} --out eval/results/tasks-holdout2-sonnet.json   # 同上`,
      `node eval/outcome.mjs --split holdout2 --runs ${PLAN.runs} --budgets ${budgets} --max-usd ${qa} --out eval/results/outcome-holdout2.json   # --budgets（2a で実装）`,
      `node eval/plugin.mjs --split holdout2 --runs ${PLAN.runs} --max-usd ${plugins} --out eval/results/plugin-holdout2.json   # 実装済み`,
      `node eval/real-compaction.mjs --split holdout2 --tasks ${PLAN.realCompactionTasks} --runs ${PLAN.runs} --max-usd ${real} --out eval/results/real-compaction-holdout2.json   # 新規（2a で実装）`,
      '',
      '# 4. 人手の抜き取り検査（120件）と、文書の数値の生成。実装済み',
      'node eval/spot-check.mjs --from eval/results/outcome-holdout2.json --sample 120 --seed 20261001 --out eval/results/human-review/holdout2-items.json',
      'node eval/review.mjs eval/results/human-review/holdout2-items.json',
      'node eval/spot-check.mjs --kappa eval/results/human-review/holdout2-items.json',
      'node eval/check-docs.mjs --write',
      '```',
    ].join('\n'),
  )
}

/** Round 2b's cost checkpoints: each paid step's cap and the running total, from the same estimate. */
function designCheckpoints() {
  const { rows } = costEstimates()
  const steps = [
    ['2b-1', '課題成功（Haiku 4.5）', rows[0]],
    ['2b-2', '課題成功（Sonnet 5、主予算のみ）', rows[1]],
    ['2b-3', '質問応答（Haiku 回答＋Sonnet 採点）', rows[2]],
    ['2b-4', 'プラグイン（模擬の圧縮）', rows[3]],
    ['2b-5', '本物の Claude Code 圧縮', rows[4]],
  ]
  let total = 0
  return block(
    table(
      ['チェックポイント', '内容', '見積もり（USD）', 'このコマンドの上限（--max-usd）', '累計の上限'],
      steps.map(([id, label, row]) => {
        total += cap(row[2])
        return [id, label, `$${row[2].toFixed(0)}`, `$${cap(row[2])}`, `$${total}`]
      }),
    ),
  )
}

// --- the Round 1 changes record (docs/audits/2026-09-25-round-1-changes-ja.md, in Japanese) -----

const holdoutPrecommit = JSON.parse(readFileSync(join(here, 'results/superseded/retention-holdout-precommit.json'), 'utf8'))

function changesHoldoutRetention() {
  const r = retentionHoldout.retention
  return `Jev ${pct1(r.jev[0.25].probes)}、ランダム順 ${pct1(r.random[0.25].probes)}、キーワード一致 ${pct1(r.local[0.25].probes)}、切り捨て ${pct1(r.recency[0.25].probes)}`
}

function changesPrecommit() {
  const d = holdoutPrecommit.retentionDifference['0.25']
  return `Jev ${pct1(holdoutPrecommit.retention.jev[0.25].probes)}（Jev − 切り捨て ${points1(d.probes)} ${interval1(d.low, d.high)}）`
}

function changesAtCut() {
  const r = retentionHoldout.exploratory.atCut
  const c = r.comparisons.random['0.25']
  return `Jev ${pct1(r.retention.jev[0.25].probes)}、切り捨て ${pct1(r.retention.recency[0.25].probes)}、ランダム順 ${pct1(r.retention.random[0.25].probes)}（Jev − ランダム順 ${points1(c.probes)} ${interval1(c.low, c.high)}）`
}

/** The audit's 4.3-2 finding, recomputed from the session files: tokens after the cut, and probes only stated there. */
function changesCutAnalysis() {
  const dir = join(root, 'examples/eval-sessions')
  const rows = { dev: [], holdout: [] }
  for (const name of readdirSync(dir).filter((f) => f.startsWith('recorded-'))) {
    const session = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    const entries = messagesToEntries(session.messages)
    const byId = new Map(entries.map((e) => [e.id, e]))
    const total = entries.reduce((sum, e) => sum + e.sourceTokens, 0)
    const after = entries.filter((e) => e.timestamp > session.cutAfterMessage).reduce((sum, e) => sum + e.sourceTokens, 0)
    const onlyAfter = session.probes.filter((p) => p.entryIds.every((id) => byId.get(id)?.timestamp > session.cutAfterMessage)).length
    rows[sessionSplit(name)]?.push({ share: after / total, onlyAfter }) // Round 1's two splits only
  }
  const range = (xs) => `${pct0(Math.min(...xs))}〜${pct0(Math.max(...xs))}`
  const counts = (rs) => [...new Set(rs.map((r) => r.onlyAfter))].sort().join('・')
  return `ホールドアウト ${rows.holdout.length} 会話では切り取り点以降がトークンの ${range(rows.holdout.map((r) => r.share))}、そこにしかない事実は各 ${counts(rows.holdout)} 件。dev の記録 ${rows.dev.length} 会話では各 ${counts(rows.dev)} 件`
}

/** How many sessions each split has, and of what kind: counted from the files, never typed. */
function sessionCounts() {
  const names = readdirSync(join(root, 'examples/eval-sessions')).filter((f) => f.endsWith('.json'))
  const dev = names.filter((f) => sessionSplit(f) === 'dev')
  const recorded = dev.filter((f) => f.startsWith('recorded-')).length
  return `${dev.length} of the ${names.length} sessions: ${dev.length - recorded} written by hand and ${recorded} recorded`
}

/** How precise a task-success difference was with 10 dev tasks, and the rough width with the plan's task count. */
function designPrecision() {
  const d = taskDiff(tasksDev.rows, SHIPPED, TRUNCATION)
  const width = (d.interval[1] - d.interval[0]) * 100
  const scaled = width * Math.sqrt(new Set(tasksDev.rows.map((r) => r.task)).size / PLAN.tasks)
  return `dev（10課題×2回）での差の95%CI幅は ${Math.round(width)} ポイントでした。課題数だけで単純に換算すると ${PLAN.tasks} 課題では約 ${Math.round(scaled)} ポイント`
}

const RENDERERS = {
  'design-task-success': designTaskSuccess,
  'design-retention': designRetention,
  'design-retention-diffs': designRetentionDiffs,
  'design-jev-spread': designJevSpread,
  'design-outcome-plugin': designOutcomeAndPlugin,
  'design-cost': designCost,
  'design-commands': designCommands,
  'design-checkpoints': designCheckpoints,
  'design-recovered-retention': designRecoveredRetention,
  'local-calibration': localCalibrationSummary,
  'ja-holdout-primary': jaHoldoutPrimary,
  'design-precision': designPrecision,
  'changes-holdout-retention': changesHoldoutRetention,
  'changes-precommit': changesPrecommit,
  'changes-at-cut': changesAtCut,
  'changes-cut-analysis': changesCutAnalysis,
  'holdout-tasks': holdoutTaskTable,
  'holdout-task-diff': holdoutTaskDiff,
  'holdout-retention': holdoutRetention,
  'dev-tasks': devTaskTable,
  'dev-task-diff': devTaskDiff,
  'dev-sonnet': devSonnet,
  'dev-vs-local': devVsLocal,
  outcome: outcomeTable,
  'outcome-diff': outcomeDiff,
  'dev-retention': devRetention,
  plugin: pluginTable,
  'plugin-diff': pluginDiff,
  'prereg-primary': preregPrimaryTable,
  'prereg-primary-diff': preregPrimaryDiff,
  'prereg-secondary-rerun': preregSecondaryRerun,
  'prereg-exploratory-at-cut': preregExploratoryAtCut,
  'holdout-plugin': holdoutPlugin,
  'plugin-holdout-inline': pluginHoldoutInline,
  'prereg-plugin-rerun': preregPluginRerun,
  'design-plugin-holdout': designPluginHoldout,
  'session-counts': sessionCounts,
}

// --- checking -----------------------------------------------------------------------------------

const DOCS = [
  { path: 'README.md', section: /^## Does It Work\?/m },
  { path: 'packages/core/eval/PREREGISTRATION.md', section: /^## Results/m },
  { path: 'docs/design/round-2-scoring-and-evaluation.md', section: /^## 1\./m },
  // No results section to police here: its tables are statuses, and its eval numbers are generated inline.
  { path: 'docs/audits/2026-09-25-round-1-changes-ja.md' },
  { path: 'packages/claude-plugin/README.md' },
  // Status tables, not results; the eval numbers in them are generated inline.
  { path: 'docs/audits/2026-09-25-audit-2-triage-ja.md' },
]
const GENERATED = /<!-- generated:([\w-]+) -->([\s\S]*?)<!-- \/generated:\1 -->/g

/** Every table in the results section must be generated or explicitly marked unverified. */
function uncheckedTables(text, section) {
  const start = text.search(section)
  if (start === -1) return ['the results section is missing']
  const rest = text.slice(start)
  const next = rest.slice(3).search(/^## /m)
  const body = next === -1 ? rest : rest.slice(0, next + 3)
  const generatedSpans = [...body.matchAll(GENERATED)].map((m) => [m.index, m.index + m[0].length])
  const lines = body.split('\n')
  const problems = []
  let offset = 0
  let previous = ''
  let inTable = false
  for (const line of lines) {
    const isRow = line.trimStart().startsWith('|')
    if (isRow && !inTable) {
      const inside = generatedSpans.some(([a, b]) => offset >= a && offset < b)
      if (!inside && !/^<!-- unverified: .+ -->$/.test(previous.trim())) problems.push(`a table that's neither generated nor marked unverified: ${line.trim().slice(0, 80)}`)
    }
    inTable = isRow
    if (line.trim()) previous = line
    offset += line.length + 1
  }
  return problems
}

const write = process.argv.includes('--write')
const used = new Set()
let failed = false
for (const { path, section } of DOCS) {
  const file = join(root, path)
  const text = readFileSync(file, 'utf8')
  const updated = text.replace(GENERATED, (whole, name, current) => {
    const render = RENDERERS[name]
    if (!render) {
      console.error(`${path}: no renderer for generated block "${name}"`)
      failed = true
      return whole
    }
    used.add(name)
    const expected = render()
    if (expected !== current && !write) {
      console.error(`${path}: generated block "${name}" differs from the saved results.\n--- in the file:\n${current}\n--- from eval/results/:\n${expected}\n`)
      failed = true
    }
    return `<!-- generated:${name} -->${expected}<!-- /generated:${name} -->`
  })
  for (const problem of section ? uncheckedTables(updated, section) : []) {
    console.error(`${path}: ${problem}`)
    failed = true
  }
  if (write && updated !== text) {
    writeFileSync(file, updated)
    console.log(`rewrote the generated blocks in ${path}`)
  }
}
for (const name of Object.keys(RENDERERS)) {
  if (!used.has(name)) {
    console.error(`renderer "${name}" isn't used by any doc`)
    failed = true
  }
}
if (failed) {
  console.error(write ? 'check-docs: fix the problems above.' : 'check-docs: the docs disagree with eval/results/. Run `node eval/check-docs.mjs --write` if the saved results are right.')
  process.exit(1)
}
if (!write) console.log(`check-docs: every eval number in ${DOCS.map((d) => d.path.split('/').at(-1)).join(', ')} matches eval/results/.`)
