# Evaluation

What ctxjev's pruning has and hasn't been shown to do, measured on small coding tasks. The
[README](../README.md#status-and-limits) has the one-paragraph summary; this page has the numbers,
how they were produced, and what they can't tell you.

**The short answer.** On tasks the design had never seen, no scorer has been shown to help an agent
finish more tasks than plain truncation (keeping the newest entries). On how much of what a task
needed survives a tight budget, Jev's ranking beat truncation only because truncation keeps none of
it by construction on that measure, and on the preregistered version of it kept less than a random
ordering of the same entries. The
Claude Code plugin's digest has no demonstrated effect. That is why every entry point except the
MCP tools defaults to an offline scorer.

## How to read these numbers

- **Dev** (<!-- generated:session-counts -->15 of the 21 sessions: 5 written by hand and 10 recorded<!-- /generated:session-counts --> in [`examples/eval-sessions`](../examples/eval-sessions), and the tasks they were
  recorded on) informed the design: `keepUserText`, the removal note, and the plugin's goal
  inference were all built from failures seen on it. Read dev numbers as optimistic.
- **Holdout** (<!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> further tasks, recorded and labeled after that design was frozen, and
  [preregistered](../packages/core/eval/PREREGISTRATION.md) before any of them were scored) is
  what decided the default scorer. It has now been run and analyzed, so it is used up: it can't
  confirm anything new. A fresh held-out set, checked independently, is future work.
- Intervals are 95% bootstrap intervals that resample whole sessions or tasks. With this few tasks
  they're wide, and they're shown so you can see how wide.
- Every number on this page is generated from the saved results in
  [`eval/results/`](../packages/core/eval/results) by
  [`eval/check-docs.mjs`](../packages/core/eval/check-docs.mjs), and CI fails if they disagree. So
  does a number typed into the prose here instead of generated.

## Held-out tasks: does Jev's ranking beat plain truncation?

No, on task success; and on what survives a tight budget, no better than chance. <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> tasks
(`rate-limit-window`, `coupon-stacking`, `upload-size-limit`, `audit-retention`, `shipping-fee`,
`room-booking`), each with a mid-session constraint and another changed or added later, run through
[`eval/tasks.mjs`](../packages/core/eval/tasks.mjs) and [`eval/run.mjs`](../packages/core/eval/run.mjs)
exactly as preregistered:

<!-- generated:holdout-tasks -->
| Task success (3 runs/task/model, budget 25%) | Claude Haiku 4.5 | Claude Sonnet 5 |
| --- | --- | --- |
| Everything | 100% | not run |
| **Pruned by Jev, as shipped** | **100%** | **100%** |
| Pruned by plain truncation, same options | 100% | 100% |
| Goal only | 0% | not run |
<!-- /generated:holdout-tasks -->

Jev minus truncation: <!-- generated:holdout-task-diff -->**0 points, 95% CI [0, 0]** with Claude Haiku 4.5 and **0 points, 95% CI [0, 0]** with Claude Sonnet 5<!-- /generated:holdout-task-diff -->.
Every task passed under every history condition tested, on every run; only removing the history
entirely (`goal-only`) failed. That's the preregistered primary rule, and its answer is that Jev's
ranking made no difference here.

The preregistered secondary measure asks what the ranking alone keeps: the share of each session's
labeled facts (probes) still present after pruning to a 25% budget, with `keepUserText` and the
removal note off. Alongside Jev and truncation are keyword overlap, a random order, and the labels
themselves:

<!-- generated:holdout-retention -->
| What survives a 25% budget (ranking alone, no `keepUserText`; Jev: mean of 3 runs) | Whole session (v1, preregistered) | Up to the fix request (v2, exploratory here) |
| --- | --- | --- |
| **Jev** | **23.6%** | 41.1% |
| Plain truncation (newest kept) | 0.0% | 31.0% |
| Keyword overlap (`scorer: 'local'`, offline, free) | 28.3% | 37.5% |
| Random order (mean of 20 seeds) | 26.5% | 33.5% |
| The labels themselves (relevant entries first) | 32.7% | 31.0% |

**On the holdout, Jev kept less of what the tasks needed than a random ordering of the same entries did** (23.6% vs. 26.5%), and less than keyword overlap (28.3%). It beat plain truncation only because truncation scores 0% on the preregistered measure by construction (see below).

Preregistered measure: Jev minus plain truncation is +23.6 points, 95% CI [+9.5, +37.7]. Exploratory comparisons on the same measure: Jev minus random order is −2.9 points [−12.4, +6.4], and Jev minus keyword overlap −4.7 [−19.1, +11.7]. Up to the fix request (v2): Jev minus plain truncation is +10.1 points [+0.7, +22.0], and Jev minus random order +7.6 [−2.4, +19.7].
<!-- /generated:holdout-retention -->

Read the preregistered column with these in mind, both found by an
[independent audit](audits/2026-09-24-audit-ja.md) (in Japanese):

- It measures the **whole** recorded session, including the implementation after the fix request.
  On the holdout sessions that part is a large share of the tokens but holds none of the labeled
  facts, so plain truncation, which keeps the newest entries, can't score anything by construction.
  (Each dev session labels a fact there, which is part of why the splits disagree.) The "up to the fix
  request" column measures what `tasks.mjs` actually prunes instead. It was added after the
  results were seen, is labeled exploratory in
  [`PREREGISTRATION.md`](../packages/core/eval/PREREGISTRATION.md), and decides nothing.
- Jev's answers vary between runs. This is a saved re-run of the preregistered command; earlier
  runs, whose output wasn't saved, gave different values (all of them are in `PREREGISTRATION.md`).
  With this few sessions, differences of a few points are within that variation.

On the dev sessions, Jev beat keyword overlap by a wide margin
(<!-- generated:dev-vs-local -->85.6% vs. 65.3% at a 25% budget<!-- /generated:dev-vs-local -->); on the holdout it didn't.

**What this changes:** the default scorer for `ctxjev-core`, `ctxjev-cli`, and `pruneMessages()` is
now `'recency'` (plain truncation). Pass `scorer: 'jev'` / `--scorer jev` to opt in.
[`PREREGISTRATION.md`'s Results section](../packages/core/eval/PREREGISTRATION.md) has the full
numbers and commands.

## Held-out tasks: does the Claude Code plugin's digest help?

No demonstrated effect. The preregistered plugin comparison
([`eval/plugin.mjs`](../packages/core/eval/plugin.mjs) `--split holdout`: the summary of a simulated
compaction alone, against the same summary plus the plugin's digest, decided on tasks passed) errored
on its first attempt because the hook couldn't reach Jev from the recording sandbox. It was then run
to completion on 2026-09-24 in <!-- generated:plugin-run-count -->two<!-- /generated:plugin-run-count --> separate sessions on the same code, but both results sat on
branches that were never merged until they were
[recovered](../packages/core/eval/results/README.md#recovered-from-archive-tags-2026-09-25) on
2026-09-25. Both runs are shown; neither was chosen in advance as *the* run.

<!-- generated:holdout-plugin -->
| After a simulated compaction (holdout, Claude Haiku 4.5) | Run `d8aa0b1`: tasks passed | answers right | Run `042cf4c`: tasks passed | answers right |
| --- | --- | --- | --- | --- |
| Summary alone | 100% | 78% | 100% | 79% |
| Summary + digest (goal inferred by the plugin) | 94% | 88% | 83% | 82% |
| Summary + digest (the same goal, set with `/ctxjev:set-goal`) | 100% | 88% | 89% | 85% |
| Digest (inferred goal) − summary alone, 95% CI | −6 [−17, 0] | +10 [+5, +14] | −17 [−39, 0] | +3 [−3, +9] |
| Digest (set goal) − summary alone, 95% CI | 0 [0, 0] | +10 [+1, +16] | −11 [−22, 0] | +6 [−1, +15] |

Run `d8aa0b1`: 6 tasks × 3 runs, and the hook scored with Jev in 18 of 18; Run `042cf4c`: 6 tasks × 3 runs, and the hook scored with Jev in 18 of 18. In both runs the two digest conditions scored against the identical goal (18 of 18, 18 of 18), so they are the same configuration measured twice (the goal supplied two ways), not two different goals. **No tasks-passed interval clears zero in either run, so by the preregistered rule the digest has no demonstrated effect on unseen tasks.** Answers right isn't the registered measure; it's shown because the two runs disagree there too.
<!-- /generated:holdout-plugin -->

**What this changes:** with no demonstrated effect from the Jev-scored digest, and Jev's ranking
below keyword overlap on the retention measure above, the plugin now scores offline by keyword
overlap by default and sends nothing; Jev is opt-in with `CTXJEV_SCORER=jev`. That isn't evidence
the offline digest helps either: it hasn't been shown to.

## Dev sessions (optimistic)

- **Written sessions.** Written by hand, with raw tool output, dead ends, and distractors that
  share the goal's words.
- **Recorded sessions.** Real Claude Code sessions, recorded on the throwaway task repos in
  [`examples/eval-tasks`](../examples/eval-tasks). Each task has a planted bug. The user states
  constraints partway through, and in some of them changes the plan. The session ends with the fix.

**1. Can an agent still finish the job?** [`eval/tasks.mjs`](../packages/core/eval/tasks.mjs) cuts
each recorded session before "now implement the fix" and prunes the history to 25% of its tokens.
Claude Haiku 4.5 then does the fix with real tools in a fresh copy of the repo. It passes if the
hidden acceptance tests pass, and those tests include the constraints the user stated mid-session. <!-- generated:dev-task-design -->10 tasks × 2 runs<!-- /generated:dev-task-design -->:

<!-- generated:dev-tasks -->
| History given to the agent | Tasks passed | 95% CI |
| --- | --- | --- |
| Everything | 100% | [100, 100] |
| **Pruned to 25% by Jev, as shipped** (keeps user text, marks the gap) | **100%** | [100, 100] |
| **Newest kept, with the same two options** | **90%** | [70, 100] |
| Pruned by Jev ranking alone | 90% | [75, 100] |
| Newest kept (plain truncation) | 90% | [70, 100] |
| Pruned by keyword overlap | 75% | [55, 95] |
| Only the task | 40% | [15, 70] |
<!-- /generated:dev-tasks -->

Against truncation with the same options (user text kept, gap marked), the fair comparison, Jev is <!-- generated:dev-task-diff -->+10 points [0, +30]<!-- /generated:dev-task-diff -->: <!-- generated:dev-task-misses -->truncation failed 2 of its 20 runs and Jev 0, all on `webhook-dedupe`. On the other 9 tasks both passed every run<!-- /generated:dev-task-misses -->.

The misses were agents that lost something the user said and filled the gap with their own guess.
An agent lost "keep the mark for 24 hours" and kept a later "maybe 25h for margin". Another lost the
exact masking format. That's why `pruneMessages()` now keeps what the user wrote and adds a
short note where it removed history. Both were designed from these failures, which is why these
tasks can't also be the test of them.

**With a stronger agent (Claude Sonnet 5), the difference goes away.** Same <!-- generated:dev-task-design -->10 tasks × 2 runs<!-- /generated:dev-task-design -->,
effort low: <!-- generated:dev-sonnet -->Jev as shipped passed 90%, and truncation with the same options passed 95% (−5 points [−15, 0])<!-- /generated:dev-sonnet -->. Both passed every run on <!-- generated:dev-sonnet-clean -->9 of the 10<!-- /generated:dev-sonnet-clean --> tasks. The rest is the "24 hours vs. maybe 25h"
task (<!-- generated:dev-sonnet-missed -->`webhook-dedupe`: Jev lost it in 2 of 2 runs, truncation in 1<!-- /generated:dev-sonnet-missed -->), where the recorded assistant's later suggestion contradicts the user. So at a 25% budget on tasks this size, a strong agent recovers from pruning
whichever way it's done. What made the difference for Haiku was the weaker agent, not the ranking
alone.

**2. Can a model still answer from what's left?** [`eval/outcome.mjs`](../packages/core/eval/outcome.mjs)
has Claude Haiku 4.5 answer each needed fact as a question from the pruned conversation, and Claude
Sonnet 5 grade it (<!-- generated:outcome-design -->102 questions, 2 runs<!-- /generated:outcome-design -->):

<!-- generated:outcome -->
| Context | 25% budget | 50% budget |
| --- | --- | --- |
| Everything | 95% | 95% |
| **Pruned by Jev** | **79%** | **91%** |
| Plain truncation | 71% | 83% |
| Keyword overlap | 67% | 74% |
<!-- /generated:outcome -->

The differences: <!-- generated:outcome-diff -->Jev minus truncation is +8 points [−1, +18] at 25% and +8 [−1, +19] at 50%. Jev minus keyword overlap is +13 [+7, +18] and +17 [+10, +24]<!-- /generated:outcome-diff -->. The truncation intervals include
zero. <!-- generated:dev-retention -->Ranking alone (`eval/run.mjs`, the dev sessions, Jev: mean of 3 runs) keeps 85.6% / 95.6% of the facts under a 25% / 50% budget, against 66.3% / 80.4% for truncation, 65.3% / 79.8% for keyword overlap, and 62.0% / 69.3% for a random order<!-- /generated:dev-retention -->. Every release is gated on
Jev not falling below truncation or keyword overlap there at a 50% budget
(`eval/run.mjs --gate --runs 3`, which fails without a Jev key).

**3. Does the Claude Code plugin help after a compaction?**
[`eval/plugin.mjs`](../packages/core/eval/plugin.mjs) runs the shipped hooks on each recorded
history. Claude Haiku 4.5 simulates the compaction summary; Claude Code's own compaction prompt
isn't public, so ours only approximates it, and it asks for every user instruction. The agent then
finishes the task from the summary, with or without the plugin's digest (<!-- generated:plugin-design -->10 tasks × 2 runs<!-- /generated:plugin-design -->):

<!-- generated:plugin -->
| After compaction | Tasks passed | Answers right |
| --- | --- | --- |
| Summary alone | 95% | 89% |
| Summary + digest (goal = latest message, as in 0.4.0) | 90% | 91% |
| Summary + digest (goal = first request + latest instruction, 0.5.0) | 100% | 90% |
<!-- /generated:plugin -->

**Honest reading:** against a summary that already keeps every user instruction, the digest adds
little. The 0.4.0 plugin aimed its scoring at the latest message ("also check the tests"), not the
task, and did no better than the summary alone. 0.5.0 infers the goal from the first request plus
the latest instruction. That passed every task, but <!-- generated:plugin-diff -->+5 points [0, +15]<!-- /generated:plugin-diff --> is within the noise. The
plugin's value depends on how much the compaction summary drops, and this eval can't measure
Claude Code's real compaction.

What this doesn't show:

- Any of it on unseen material. The dev tasks and sessions informed the design, and the holdout
  has since been run and analyzed, so neither can confirm a new claim.
- The tasks are small, and <!-- generated:dev-task-design -->10 tasks × 2 runs<!-- /generated:dev-task-design --> is a small sample.
- Most runs use Claude Haiku 4.5. Claude Sonnet 5 was checked on the task eval only, with fewer
  conditions.
- The recordings come from the same recording model on tasks written for this eval.
- Token counts come from `gpt-tokenizer`, an approximation of Claude's tokenizer.

Every answer, verdict, digest, summary, and agent run is in
[`eval/results/`](../packages/core/eval/results).

## Secret masking, measured blind

Before anything is sent to Jev, `redactSecrets()` masks common secret formats (see
[`packages/core/src/redact.ts`](../packages/core/src/redact.ts)). It is pattern matching, so it is
best-effort. To measure it without fooling ourselves, a separate agent that never saw the masking
code wrote each corpus from a short spec: lines with fake secrets in them, and harmless lines that
look similar. Each corpus was split at random into a dev split (used to fix misses, so optimistic)
and a holdout split, measured on the release named below and never used for tuning. The specs and
procedure are in [`packages/core/test/blind-redact*/`](../packages/core/test).

<!-- generated:masking-blind-table -->
| Blind corpus (holdout split, measured once) | Release measured | Lines with secrets masked | Harmless lines changed |
| --- | --- | --- | --- |
| Corpus 1 (`blind-redact/`) | 0.7.0 | 84 of 91 (92.3%) | 6 of 42 (14.3%) |
| Corpus 2 (`blind-redact-2/`) | 0.7.1 | 80 of 92 (87.0%) | 3 of 41 (7.3%) |
| Corpus 3 (`blind-redact-3/`) | 0.7.2 | 101 of 118 (85.6%) | 3 of 80 (3.8%) |
<!-- /generated:masking-blind-table -->

The holdout split of every corpus so far has been measured, so each is used up too: a later fix
can't be checked against it. The misses that remain are listed in the
[open masking issues](https://github.com/x96x64/ctxjev/issues?q=is%3Aissue+is%3Aopen+masking).
