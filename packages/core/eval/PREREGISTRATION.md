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
- 2026-09-24, after all the results below, in response to an independent audit
  (`docs/audits/2026-09-24-audit-ja.md`). None of this changes the plan above, the registered
  measures, or the decisions already applied; the holdout has now been seen and analyzed, so
  nothing computed on it from here on can confirm anything.
  - **The secondary endpoint's raw output was never saved.** Step 4 wrote it to
    `/tmp/run-holdout.json`, and the README cited +15.6 points [+5.1, +26.7], which matches neither
    run recorded below. `eval/run.mjs` now saves everything it computes (`--out`), and the
    registered command was re-run with its output kept in `eval/results/retention-holdout.json`
    ("Saved re-run" below). Its values differ from both earlier runs because Jev's answers vary
    between calls; the earlier runs stay in their table, marked as unverifiable.
  - **Exploratory measure added: retention up to the fix request.** The registered measure counts
    probes over the whole session. On the six holdout sessions the part after the cut point
    (`cutAfterMessage`) holds a large share of the tokens but none of the labeled probes, while each
    dev session labels one probe there, so plain truncation scores 0% on the holdout by
    construction. The exploratory measure cuts each recorded session where the fix request arrives
    (what `tasks.mjs` prunes), scores that history afresh, and leaves out probes stated only after
    the cut. It is reported next to the registered measure, never instead of it, and decides nothing.
  - **Exploratory comparisons added:** Jev against keyword overlap, random order, and the labels,
    with the same session-resampling interval. The registered comparison is still Jev − recency.
  - The heading "Steps (need Claude; not run yet)" above predates the run; the steps ran on
    2026-09-24 (see Results). It's left as written, per this file's own rule.
  - The process note at the end quoted step 3 with words step 3 doesn't contain. The quote is
    corrected to step 3's actual wording.
  - Every number in the Results section is now generated from `eval/results/` by
    `eval/check-docs.mjs`, which CI runs; tables whose raw output was never saved are marked.
- 2026-09-25, recovery of the plugin comparison. The plan above is unchanged.
  - The plugin comparison had in fact been run to completion twice (see "Plugin: two completed
    re-runs"), but neither result had reached `main`, which still said it had never produced one.
    Both files were recovered unchanged from the archive tags and are reported side by side; the
    rule is applied to each, and it gives the same branch for both.
  - Found while recovering them, and stated so it isn't mistaken for two different goals: in both
    runs the two digest conditions (`summary+ctxjev`, the goal the plugin infers, and
    `summary+ctxjev(task goal)`, set with `/ctxjev:set-goal`) scored against the identical goal on
    every task and run. Since 0.5.0 the plugin infers exactly the goal `plugin.mjs` sets for the
    second condition, so on this material the two are the same configuration measured twice.
  - The same sessions also produced one more saved run of the secondary endpoint
    (`results/run-holdout-fa22e81.json`) and of the dev reference (`results/run-dev-ac67ad5.json`).
    They re-measure material already seen and confirm nothing.
  - A second preregistration ("Round 2: long histories") was drafted in the same session and
    paused before producing any result. It was not adopted; what it contained, what it spent, and
    why it was paused are recorded in `docs/audits/2026-09-25-audit-2-triage-ja.md`.

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

<!-- generated:prereg-primary -->
| condition | Claude Haiku 4.5 | Claude Sonnet 5 |
| --- | --- | --- |
| `full` | 100% [100%, 100%] | not run |
| `goal-only` | 0% [0%, 0%] | not run |
| `jev+user+marker` | 100% [100%, 100%] | 100% [100%, 100%] |
| `recency+user+marker` | 100% [100%, 100%] | 100% [100%, 100%] |
<!-- /generated:prereg-primary -->

Every task passed under both `full` and both pruned conditions, on both models, in all 3 runs (`en`
and `ja` both 100% throughout); only `goal-only` (no history at all beyond the goal) failed, on
every task.

Jev − recency (task success), same tasks resampled together:

<!-- generated:prereg-primary-diff -->
- Claude Haiku 4.5: **0 pp, 95% CI [0, 0]**
- Claude Sonnet 5: **0 pp, 95% CI [0, 0]**
<!-- /generated:prereg-primary-diff -->

### Secondary endpoint: probe retention at a 25%/50% budget (ranking alone, `eval/run.mjs`)

Run once with `--json` and once for the printed table, per the steps above; both are independent
sets of Jev calls (Jev's answers vary between calls per fixture), so their point estimates differ
slightly — both are reported:

<!-- unverified: neither run's raw output was saved (the --json run went to /tmp); kept as recorded -->
| run          | jev − recency at 25%        | jev − recency at 50%         |
| ------------ | ---------------------------- | ----------------------------- |
| `--json` run | +20.7 pp, 95% CI [+4.8, +38.9] | +22.7 pp, 95% CI [+13.3, +32.1] |
| printed run  | **+18.5 pp, 95% CI [+7.1, +30.3]** | +26.1 pp, 95% CI [+15.6, +36.8] |

The printed run is the one the preregistration names as the secondary endpoint (step 4's fourth
command); its 25%-budget number is the one the decision rule below is applied to.

#### Saved re-run (added 2026-09-24, see "Changes after registration")

The same registered command, `node eval/run.mjs --split holdout --runs 3`, with `--out`. It
re-measures material that has already been seen, so it records the numbers rather than confirming
anything; it doesn't change the decision below.

<!-- generated:prereg-secondary-rerun -->
`retention-holdout.json`: commit `630072e`, clean tree, 3 Jev runs; Jev usage 54 requests, 316,767 input tokens (~$0.013).

| run | jev − recency at 25% | jev − recency at 50% |
| --- | --- | --- |
| saved re-run | **+23.6 pp, 95% CI [+9.5, +37.7]** | +27.4 pp, 95% CI [+15.8, +37.2] |

| ranking | probes retained at 25% | at 50% |
| --- | --- | --- |
| Jev | 23.6% | 62.5% |
| Plain truncation (newest kept) | 0.0% | 35.1% |
| Keyword overlap (`scorer: 'local'`, offline, free) | 28.3% | 66.7% |
| Random order (mean of 20 seeds) | 26.5% | 58.7% |
| The labels themselves (relevant entries first) | 32.7% | 97.9% |

The 25%-budget interval's lower bound is above 0 here too. Jev retained less than a random ordering (23.6% vs. 26.5%) and less than keyword overlap (28.3%).
<!-- /generated:prereg-secondary-rerun -->

#### Exploratory: retention up to the fix request (not preregistered)

Same file, same runs. Each recorded session is cut where the fix request arrives and scored afresh
on that history; probes stated only after the cut are left out. See "Changes after registration"
for why it was added. It decides nothing.

<!-- generated:prereg-exploratory-at-cut -->
| ranking | probes retained at 25% | at 50% |
| --- | --- | --- |
| Jev | 41.1% | 79.8% |
| Plain truncation (newest kept) | 31.0% | 78.0% |
| Keyword overlap (`scorer: 'local'`, offline, free) | 37.5% | 73.2% |
| Random order (mean of 20 seeds) | 33.5% | 66.9% |
| The labels themselves (relevant entries first) | 31.0% | 78.0% |

| Jev minus | at 25% | at 50% |
| --- | --- | --- |
| recency | +10.1 [+0.7, +22.0] | +1.8 [−5.1, +8.3] |
| local | +3.6 [−7.1, +15.3] | +6.5 [−10.1, +23.5] |
| random | +7.6 [−2.4, +19.7] | +12.8 [+2.8, +22.9] |
| labels | +10.1 [+0.7, +22.0] | +1.8 [−5.1, +8.3] |

Probes left out because only the part after the cut states them: 0.
<!-- /generated:prereg-exploratory-at-cut -->

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

### Plugin: two completed re-runs (recovered 2026-09-25)

After the proxy and deadline changes listed under "Changes after registration", the registered
command (`node eval/plugin.mjs --split holdout --runs 3 --max-usd 5 --out
eval/results/plugin-holdout.json`) was run to completion twice on 2026-09-24, from commit `2cf4eba`,
in two separate sessions at about the same time. Each committed its output as
`eval/results/plugin-holdout.json` on a branch that was never merged; both branches were deleted
after being saved as tags, and the files were recovered unchanged on 2026-09-25 (provenance, tags,
and blob hashes in [`results/README.md`](results/README.md)). This plan names one run and doesn't
say which of two would count, so both are reported, and the rule is applied to each:

<!-- generated:prereg-plugin-rerun -->
**`plugin-holdout-d8aa0b1.json`** (6 tasks × 3 runs; hook scored with Jev in 18/18; same goal in both digest conditions 18/18):

| context | tasks passed | answers right |
| --- | --- | --- |
| `summary` | 100% | 78% |
| `summary+ctxjev` | 94% | 88% |
| `summary+ctxjev(task goal)` | 100% | 88% |

- `summary+ctxjev` − `summary`: tasks passed −6 [−17, 0] pp, answers right +10 [+5, +14] pp
- `summary+ctxjev(task goal)` − `summary`: tasks passed **0 [0, 0] pp**, answers right +10 [+1, +16] pp

**`plugin-holdout-042cf4c.json`** (6 tasks × 3 runs; hook scored with Jev in 18/18; same goal in both digest conditions 18/18):

| context | tasks passed | answers right |
| --- | --- | --- |
| `summary` | 100% | 79% |
| `summary+ctxjev` | 83% | 82% |
| `summary+ctxjev(task goal)` | 89% | 85% |

- `summary+ctxjev` − `summary`: tasks passed −17 [−39, 0] pp, answers right +3 [−3, +9] pp
- `summary+ctxjev(task goal)` − `summary`: tasks passed **−11 [−22, 0] pp**, answers right +6 [−1, +15] pp
<!-- /generated:prereg-plugin-rerun -->

Claude API spend, as the two commits recorded it (the files keep per-row cost for the agent runs
only): $4.23 (`d8aa0b1`) and $4.10 (`042cf4c`), each against the $5 cap.

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

   **Applied to the two recovered re-runs (added 2026-09-25):** in both, for both digest
   conditions, the tasks-passed interval's lower bound is not above 0 (the figures are in "Plugin:
   two completed re-runs" above). **Branch: not satisfied, in both runs.** The plugin stays
   available, and the README and plugin README say it has no demonstrated effect on unseen tasks.
   The two runs' point estimates differ (see the tables above), which is itself a reminder of how
   little six tasks can separate.

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
step 3 rules out ("Labeling is the only look at the holdout sessions allowed before step 4").
Recorded here for transparency rather than left unmentioned.
