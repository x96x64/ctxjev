# Preregistration: does Jev's ranking beat truncation on unseen tasks?

Written 2026-09-24, before any holdout session was recorded or scored. Changing this file after the
holdout runs start defeats its purpose; if something here turns out unworkable, record the change
and the reason at the bottom instead of editing the plan above it.

## Why

On the ten tasks in `examples/eval-tasks` marked `"split": "dev"`, Claude Haiku 4.5 passed 20/20
runs with `jev+user+marker` and 18/20 with `recency+user+marker` (+10 points, 95% CI [0, +30]).
With Claude Sonnet 5 the order flipped: 18/20 against 19/20. Those ten tasks aren't held out:
`keepUserText`, the marker, and the plugin's goal inference in 0.5.0 were all designed from the
failures seen on them. So the one result in Jev's favor comes from the material the design was
fitted to.

## Material

Six tasks written for this comparison and marked `"split": "holdout"`: `rate-limit-window`,
`coupon-stacking`, `upload-size-limit`, `audit-retention` (English), and `shipping-fee`,
`room-booking` (Japanese). Each follows the dev tasks' shape: an investigation, a turn where the
user states constraints, a turn that changes or adds one, then "implement the fix". The hidden
acceptance tests check the mid-session constraints. `verify.mjs` and `tasks.mjs --selftest
--split holdout` pass on all six.

Until the comparison below has run, nothing about the holdout tasks or sessions may inform a change
to scoring, pruning, the plugin, or the eval harness. `eval/run.mjs --gate` reads only the dev
split for this reason.

## The comparison

- Conditions: `jev+user+marker` (what ships) and `recency+user+marker` (plain truncation with the
  same two heuristics). `full` and `goal-only` run alongside as reference points and aren't part
  of the decision.
- Budget: 25% of each history's tokens, as in the dev runs.
- Agents: Claude Haiku 4.5, and Claude Sonnet 5 at effort low. 3 runs per task, condition, and
  model.
- Measure: share of runs whose hidden acceptance tests all pass.
- Statistic: Jev minus recency per model, with a 95% bootstrap interval that resamples whole tasks
  (`rateDifference` in `lib.mjs`, as `tasks.mjs` already reports it).

## Decision rule

- If, with Claude Haiku 4.5 (the agent every dev result used), the interval's lower bound is above
  0, and with Claude Sonnet 5 the point estimate isn't below 0, Jev stays the default scorer.
- Otherwise, the default scorer for `pruneMessages()`, `pruneContext()`, and the CLI becomes
  `recency`, and Jev becomes something to opt in to with `scorer: 'jev'`. The README says why.
- Either way, the numbers go into the README next to the dev results, labeled as holdout.

## Secondary endpoint: what the ranking keeps

Task success may not separate the scorers even if Jev ranks better: the tasks' constraints come
from the user, which `keepUserText` keeps under any scorer, and an agent can re-read a file it lost.
So the ranking itself is also measured, where it can differ:

- Measure: share of each session's probes (facts the task needs later) that survive
  `pruneMessages()` at a 25% budget, ranking alone (`keepUserText` and the marker off), as
  `eval/run.mjs` reports it. Jev is the mean of 3 runs; recency is deterministic.
- Statistic: Jev minus recency, mean over the six holdout sessions, with a 95% bootstrap interval
  that resamples sessions (`node eval/run.mjs --split holdout --runs 3`; needs only
  TYPESAFE_API_KEY). The 50% budget is reported too but doesn't decide anything.
- For reference, the same statistic on the 15 dev sessions: +18.1 points [6.9, 31.2] at 25%,
  +13.0 [−0.0, 28.7] at 50%. The ten recorded dev sessions alone: 87.1% against 74.3% at 25%.
- Rule: if the interval's lower bound is above 0, the README may say that Jev keeps more of what a
  task needs than truncation does, on unseen sessions. This doesn't change the decision above: the
  default scorer is still decided by task success.

The plugin is decided separately, with the same rule, on `plugin.mjs --split holdout` (summary
alone vs. summary plus digest). If the digest doesn't clear zero, the plugin stays available and
the README says it has no demonstrated effect.

## Steps (need Claude; not run yet)

1. For each holdout task, record a session: `node examples/eval-tasks/record.mjs <task> <workdir>`.
   This runs `claude -p` with the recording account's login, not `ANTHROPIC_API_KEY`.
2. Convert it: `node packages/core/eval/import-claude-code.mjs <task> <transcript> <repo>`, and read
   the result in full before committing it (CLAUDE.md).
3. Label relevant entries and probes with `eval/label-session.mjs`. Labeling is the only look at the
   holdout sessions allowed before step 4.
4. Run, with `ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY` set:
   ```bash
   node eval/tasks.mjs --split holdout --conditions full,goal-only,jev+user+marker,recency+user+marker --runs 3 --max-usd 6 --out eval/results/tasks-holdout.json
   node eval/tasks.mjs --split holdout --conditions jev+user+marker,recency+user+marker --runs 3 --agent-model claude-sonnet-5 --max-usd 8 --out eval/results/tasks-holdout-sonnet.json
   node eval/plugin.mjs --split holdout --runs 3 --max-usd 5 --out eval/results/plugin-holdout.json
   node eval/run.mjs --split holdout --runs 3   # the secondary endpoint; Jev only
   ```
5. Apply the decision rule and write down the result here.

## Known limits this doesn't fix

- Six tasks is still a small sample; an interval that includes zero is the likely outcome if the
  true difference is a few points.
- Recordings still come from one model (`record.mjs` uses Sonnet).
- Token budgets use `gpt-tokenizer`, an approximation of Claude's tokenizer. Counting with the
  Anthropic token-counting endpoint would need the Claude API on every run.

## Changes after registration

- 2026-09-24, before any holdout session was recorded: added the secondary endpoint (probe
  retention) and the interval `eval/run.mjs` now prints for it. Reason: the holdout tasks, like the
  dev ones, test constraints the user stated, which every scorer keeps, so task success alone can't
  show a ranking difference that the dev retention numbers suggest exists.
- 2026-09-24, after the primary and secondary endpoints ran, before the plugin comparison had
  produced any result: `eval/plugin.mjs` now forwards the parent's proxy and CA settings to the
  hook subprocess, and the plugin's Jev deadline went from 8s to 20s. Reasons: in the cloud sandbox
  the hook couldn't reach Jev at all without the proxy settings, and on a local rerun an 8s deadline
  still fell back to offline scoring on ordinary transcripts, so the comparison measured timeouts,
  not the digest. Neither change touches what the plugin scores or how the digest is built.

## Results

Run 2026-09-24, after all six holdout sessions were hand-labeled and committed (`claude/holdout-results`,
labeling commit before any of the runs below). Commands, from `packages/core` with both
`ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY` set, in this order:

```bash
node eval/tasks.mjs --split holdout --conditions full,goal-only,jev+user+marker,recency+user+marker --runs 3 --max-usd 6 --out eval/results/tasks-holdout.json
node eval/tasks.mjs --split holdout --conditions jev+user+marker,recency+user+marker --runs 3 --agent-model claude-sonnet-5 --max-usd 8 --out eval/results/tasks-holdout-sonnet.json
node eval/plugin.mjs --split holdout --runs 3 --max-usd 5 --out eval/results/plugin-holdout.json
node eval/run.mjs --split holdout --runs 3 --json > /tmp/run-holdout.json
node eval/run.mjs --split holdout --runs 3
```

### Primary endpoint: task success

Hidden acceptance tests passed, all six holdout tasks, 3 runs each (95% CI resamples tasks):

| condition             | Claude Haiku 4.5   | Claude Sonnet 5    |
| --------------------- | ------------------ | ------------------ |
| `full`                 | 100% [100%, 100%]  | not run            |
| `goal-only`            | 0% [0%, 0%]         | not run            |
| `jev+user+marker`      | 100% [100%, 100%]  | 100% [100%, 100%]  |
| `recency+user+marker`  | 100% [100%, 100%]  | 100% [100%, 100%]  |

Every task passed under both `full` and both pruned conditions, on both models, in all 3 runs (`en`
and `ja` both 100% throughout); only `goal-only` (no history at all beyond the goal) failed, on
every task.

Jev − recency (task success), same tasks resampled together:

- Claude Haiku 4.5: **+0 pp, 95% CI [+0, +0]**
- Claude Sonnet 5: **+0 pp, 95% CI [+0, +0]**

### Secondary endpoint: probe retention at a 25%/50% budget (ranking alone, `eval/run.mjs`)

Run once with `--json` and once for the printed table, per the steps above; both are independent
sets of Jev calls (Jev's answers vary between calls per fixture), so their point estimates differ
slightly — both are reported:

| run          | jev − recency at 25%        | jev − recency at 50%         |
| ------------ | ---------------------------- | ----------------------------- |
| `--json` run | +20.7 pp, 95% CI [+4.8, +38.9] | +22.7 pp, 95% CI [+13.3, +32.1] |
| printed run  | **+18.5 pp, 95% CI [+7.1, +30.3]** | +26.1 pp, 95% CI [+15.6, +36.8] |

The printed run is the one the preregistration names as the secondary endpoint (step 4's fourth
command); its 25%-budget number is the one the decision rule below is applied to.

### Plugin (`eval/plugin.mjs --split holdout`): not evaluated

`eval/plugin.mjs` errored on the first task (`audit-retention: the plugin scored with local (),
not Jev`) and wrote no output file — nothing to report. Diagnosis: `plugin.mjs`'s `runHook()` runs
`preCompact.js` in a subprocess with only `{PATH, TYPESAFE_API_KEY, CTXJEV_STATE_DIR}` in its
environment, by design (matching what a real Claude Code hook environment provides — see
`packages/claude-plugin/src/preCompact.ts`). This session's sandbox routes all outbound HTTPS
through a local proxy (`HTTPS_PROXY`), which that narrowed environment doesn't carry, so the
subprocess's Jev request fails immediately (confirmed by hand: `env -i PATH=... TYPESAFE_API_KEY=...
CTXJEV_STATE_DIR=... node dist/preCompact.js` → `Connection error: fetch failed`, falling back to
`local`); `plugin.mjs` then throws because it expects `jev`. This is a property of this run's
sandbox, not of the plugin or the harness, and neither is in scope to change here (`packages/*/src`
and `eval/*.mjs` are both off-limits for this task). The plugin comparison needs to be re-run in an
environment where the hook subprocess can actually reach Jev.

### Decision rules applied

1. **Primary (default scorer).** Rule: if Haiku's Jev − recency interval's lower bound is above 0,
   and Sonnet's point estimate isn't below 0, Jev stays the default. Haiku's interval is
   **[+0, +0]** — the lower bound is 0, not above 0 — so the "if" already fails regardless of
   Sonnet (whose point estimate, +0 pp, does happen to satisfy its own half). **Branch: Otherwise.**
   The default scorer for `pruneMessages()`, `pruneContext()`, and the CLI becomes `recency`; Jev
   becomes opt-in via `scorer: 'jev'`. Both scorers pass every holdout task at both budgets tested
   here, so this is a "no measurable difference on this material" result, not evidence recency is
   better — but the preregistered rule is written on the interval alone, and it does not clear zero.
2. **Secondary (what the ranking keeps).** Rule: if the interval's lower bound is above 0, the
   README may say Jev keeps more of what a task needs than truncation does, on unseen sessions.
   The printed run's 25%-budget interval is **[+7.1, +30.3]**, and the `--json` run's is
   **[+4.8, +38.9]** — both lower bounds are above 0. **Branch: satisfied.** The README may state
   that Jev retains more of what a task needs than plain truncation on unseen sessions, at a 25%
   budget; this does not change the decision above — the default scorer is still `recency` per rule 1.
3. **Plugin.** Rule: same rule, on `plugin.mjs --split holdout` (summary vs. summary+digest); if the
   digest doesn't clear zero, the plugin stays available and the README says it has no demonstrated
   effect. **Branch: not determined.** The command didn't produce a result (see above), so neither
   branch of the rule can be applied from this run. No README change follows from this run either
   way; the plugin's status is unchanged pending a re-run.

### Spend

Claude API (`ANTHROPIC_API_KEY`): $3.03 (`tasks-holdout.json`, Claude Haiku 4.5) + $1.71
(`tasks-holdout-sonnet.json`, Claude Sonnet 5) + $0.02 (`plugin.mjs`, before it errored) =
**$4.76 total**. `eval/run.mjs` uses only `TYPESAFE_API_KEY` (Jev) and reports no dollar cost.

### Process note

Before committing the six labeled sessions, `eval/run.mjs --split holdout --runs 1` was run once by
mistake to sanity-check that the label files loaded correctly (it queries the live `local` and
`jev` scorers). This happened after all six sessions were fully labeled by hand from content alone
and before any label was reconsidered, so no label was chosen or adjusted with knowledge of a
scorer's output — but it was still run before the labels were committed, which the preregistration's
step 3 says not to do ("you must not run any scorer ... before all six sessions are labeled and
committed"). Recorded here for transparency rather than left unmentioned.

### Plugin (rerun)

Run 2026-09-24, in an environment where `preCompact.js`'s subprocess can reach Jev directly (no
proxy needed here; confirmed beforehand with the same check the earlier attempt used — the hook
subprocess scored with `jev`, not `local`).

Command: `node eval/plugin.mjs --split holdout --runs 3 --max-usd 5 --out eval/results/plugin-holdout.json`

After a simulated compaction (claude-haiku-4-5; 95% intervals resample tasks):

| context | tasks passed | 95% CI | answers right | 95% CI |
| --- | --- | --- | --- | --- |
| summary | 100% | [100%, 100%] | 79% | [70%, 88%] |
| summary+ctxjev | 83% | [61%, 100%] | 82% | [74%, 91%] |
| summary+ctxjev(task goal) | 89% | [78%, 100%] | 85% | [76%, 94%] |

- summary+ctxjev − summary, tasks passed: -17 pp [-39, +0]
- summary+ctxjev − summary, answers right: +3 pp [-3, +9]
- summary+ctxjev(task goal) − summary, tasks passed: -11 pp [-22, +0]
- summary+ctxjev(task goal) − summary, answers right: +6 pp [-1, +15]

Spend: $4.10 (claude-haiku-4-5 1,120,905 in + 602,140 cache-write + 2,738,292 cache-read /
316,444 out; claude-sonnet-5 145,914 in + 0 cache-write + 0 cache-read / 7,557 out).

**Rule 3 applied to `summary+ctxjev(task goal)` (what 0.5.0+ ships):** the lower bound of the 95%
interval for tasks passed is -22, not above 0. **Branch: not satisfied.** The plugin has no
demonstrated effect on this material; it stays available, and the README and plugin README say so.

## Round 2: long histories (registered 2026-09-24, before any round-2 run)

### Why

Round 1 couldn't separate anything: summary alone passed every holdout task, because the recorded
histories (3k–23k tokens) are short enough for a compaction summary to keep nearly everything. The
plugin exists for sessions long enough that the summary has to leave things out. Round 2 measures
that case, with Claude Code's own compaction instead of our approximation of it. It is scored under
the fixed rubric in [RUBRIC.md](RUBRIC.md) (criterion A).

### Material, and what it has already been exposed to

- All 16 tasks' recorded sessions, each history before the fix prompt padded to about 80k tokens
  with irrelevant tool traffic (access logs, dependency trees, lint output, unrelated commits, file
  listings) by [`lengthen.mjs`](lengthen.mjs): generated deterministically, seeded by the task name,
  unrelated to any task's domain, and never removing or altering an original message. Sizes and a
  hash of each padded history are in `node eval/lengthen.mjs` (listed below).
- **None of this material is unseen.** The ten dev tasks informed the design; the six holdout
  tasks were used in round 1, and round 1's holdout retention numbers are why the plugin's default
  scorer became keyword overlap before this registration. What is new is the length, the real
  compaction, and the endpoint. Nothing about scoring, the digest, the padding, or the harness
  changes between this registration and the run.
- One design change was tried on dev before registering and not adopted: giving user messages no
  digest slot (the summary quotes the user anyway). Offline (`eval/digest-coverage.mjs --split
  dev`, no API calls), probes no user message states went from 28/35 to 29/35 covered by the
  digest, while all probes went from 47/57 to 42/57. One probe is noise, and overall coverage
  fell, so the shipped digest is unchanged. (Before registering I had written "adopt if the first
  number goes up"; it did, by one probe; this records why it wasn't followed.)
- A smoke run on one dev task (`invoice-rounding`, one run) checked the harness and its cost
  ($0.25). It is excluded from the results; it showed +17 points on answers right for the local
  digest on that one task and run, which is not evidence of anything.

### Conditions and measurement

- Compaction: Claude Code 2.1.281's own `/compact`, run headlessly on the padded transcript
  (`claude -p /compact --resume`, clean environment, `--model haiku`: a cost choice; a real session
  compacts with its own model). One compaction per task and run, shared by every condition.
- Conditions: `summary` (the compaction summary alone); `summary+digest(local)` (plus the shipped
  plugin's digest with its inferred goal, scored offline: the 0.6.0 default);
  `summary+digest(jev)` (the same, `CTXJEV_SCORER=jev`).
- Probe answers: Claude Haiku 4.5 answers each probe question from the context; Claude Sonnet 5
  judges the answer against the probe's fact (`createQA` in `lib.mjs`, as in round 1). 101 probes
  across the 16 tasks, per condition and run.
- Task success: Claude Haiku 4.5 finishes the task from `summary` and from
  `summary+digest(local)`, one run per task (the costly part).

### Endpoints and rule

- **Primary:** answers right, `summary+digest(local)` minus `summary`, 16 tasks × 2 runs, 95%
  bootstrap interval resampling tasks (`rateDifference`/`bootstrap` in `lib.mjs`, as
  `plugin.mjs --report` prints it).
  - Lower bound above 0: the plugin's digest has a demonstrated effect on long sessions after
    Claude Code's real compaction. The README leads with it.
  - Otherwise: no demonstrated effect in either round. The README and plugin README say so, and
    the project is repositioned to what the evidence supports (see RUBRIC.md).
- **Secondary (reported, not decisive):** tasks passed, same difference, one run per task; and
  `summary+digest(jev)` minus `summary` and minus `summary+digest(local)` on answers right.
- If the spend cap stops the run, the results file is written marked `partial`, the rule is applied
  to the tasks that finished, with that stated, and nothing is rerun with a higher cap.

### Command and spend

```bash
cd packages/core
node eval/plugin.mjs --split all --history long --compaction real \
  --conditions 'summary,summary+digest(local),summary+digest(jev)' \
  --agent-conditions 'summary,summary+digest(local)' --agent-runs 1 \
  --runs 2 --max-usd 8.5 --out eval/results/plugin-long.json
```

The Anthropic API budget for all of round 2 is $10: $0.27 already spent (a $0.015 feasibility
check of headless `/compact` and the $0.25 smoke run) plus at most $8.50 here; the estimate is
about $6.50. Jev (TypeSafe) calls for the `jev` condition are not metered by the harness.

Padded histories (`node eval/lengthen.mjs`):

```
audit-retention          4607 →  85117 tokens, 46 → 102 messages, sha256 8f7afd9866d8
config-precedence       22201 →  84600 tokens, 50 → 90 messages, sha256 5788a18eeac6
coupon-stacking          4188 →  80185 tokens, 30 → 88 messages, sha256 e3bc60d87caf
csv-import-encoding     20308 →  81660 tokens, 32 → 98 messages, sha256 7277cc58acba
flag-rollout            18319 →  83694 tokens, 26 → 76 messages, sha256 46dbb1c03d40
invoice-rounding         7371 →  82316 tokens, 50 → 106 messages, sha256 bba45d808050
month-boundary          19580 →  86216 tokens, 30 → 70 messages, sha256 289357ab6ec5
permission-check        18410 →  83869 tokens, 22 → 80 messages, sha256 a1e6df8f4535
pii-logging             18661 →  84837 tokens, 30 → 76 messages, sha256 40b51e6205f3
rate-limit-window        5861 →  81995 tokens, 52 → 110 messages, sha256 45c62799efa0
retry-backoff            5100 →  81119 tokens, 32 → 98 messages, sha256 ed0a07fea218
room-booking             5389 →  81483 tokens, 30 → 86 messages, sha256 c50e67f2b035
search-normalize        19428 →  80575 tokens, 30 → 80 messages, sha256 0d422d2520fe
shipping-fee             5621 →  86744 tokens, 38 → 104 messages, sha256 045036f6678f
upload-size-limit        3287 →  81146 tokens, 30 → 98 messages, sha256 0c4e6b8dec4a
webhook-dedupe          22583 →  86585 tokens, 28 → 72 messages, sha256 8949bea7fddc
```

Note, 2026-09-24: the command above was started once and stopped by hand within the first task's
compaction, at the user's request to review the spend before continuing; it produced no results
and nothing from it was seen. Cost: at most about $0.10, so at most about $0.37 spent before the
run below. Nothing was changed before restarting it with the same command.
