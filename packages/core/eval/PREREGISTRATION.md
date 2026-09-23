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
   ```
5. Apply the decision rule and write down the result here.

## Known limits this doesn't fix

- Six tasks is still a small sample; an interval that includes zero is the likely outcome if the
  true difference is a few points.
- Recordings still come from one model (`record.mjs` uses Sonnet).
- Token budgets use `gpt-tokenizer`, an approximation of Claude's tokenizer. Counting with the
  Anthropic token-counting endpoint would need the Claude API on every run.

## Changes after registration

(none)
