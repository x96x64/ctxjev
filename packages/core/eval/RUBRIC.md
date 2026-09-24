# Rubric: how this project is scored

Fixed on 2026-09-24, before the work it scores. Earlier scores (84, then 92, then 30) were given on
different, unstated axes and before or after different evidence; this file exists so the final
score isn't one more moving target. The final grader gets this file and the repository, not the
conversation that produced them, and scores each criterion with the files that justify it.

Changing a criterion or its weights after this date defeats the purpose. If one turns out
unworkable, record the change and the reason at the bottom instead of editing it.

| | Criterion | Points | Full marks when |
| --- | --- | --- | --- |
| A | **Demonstrated benefit to users** | 35 | The preregistered primary endpoint's 95% interval has its lower bound above 0. Point estimate above 0 but the interval includes 0: 15. Point estimate at or below 0: 0. Only a result recorded in `PREREGISTRATION.md` counts. |
| B | **Claims match evidence** | 20 | Every number in `README.md`, `packages/claude-plugin/README.md`, and `CHANGELOG.md` traces to a file in `packages/core/eval/results/` or to `PREREGISTRATION.md`; no two places disagree; nothing is claimed beyond what those files show. |
| C | **Cost and risk proportionate to benefit** | 15 | By default nothing leaves the user's machine; anything that can delay the user (compaction) has a bounded wait; any path that sends content elsewhere is opt-in, masked, and disclosed. |
| D | **Engineering quality** | 15 | `pnpm build`, `pnpm test`, `pnpm lint` pass; `packages/claude-plugin/dist/` matches its source; versions are lockstep; new code has tests. |
| E | **Evaluation practice** | 15 | Endpoints and decision rules registered before the run; intervals reported; material and its prior exposure disclosed; commands to reproduce; API spend reported. |

A cannot be raised by editing the repository: it moves only with a new preregistered result. Without
one, the maximum is 65.

## Changes after this rubric was fixed

(none yet)
