# Saved eval results

Every eval number in README.md, PREREGISTRATION.md, and the Japanese docs under `docs/` is generated
from these files by `eval/check-docs.mjs`, which CI runs. Nothing here is edited by hand; a file
that came from somewhere other than the command that wrote it says so below.

| File | What wrote it | Split |
| --- | --- | --- |
| `tasks.json`, `tasks-sonnet.json` | `eval/tasks.mjs` (Claude Haiku 4.5; Claude Sonnet 5 at effort low) | dev |
| `tasks-holdout.json`, `tasks-holdout-sonnet.json` | `eval/tasks.mjs --split holdout`, the preregistered primary endpoint | holdout |
| `outcome.json` | `eval/outcome.mjs` | dev |
| `plugin.json` | `eval/plugin.mjs` | dev |
| `retention-dev.json`, `retention-holdout.json` | `eval/run.mjs --runs 3 --out …` at commit 630072e (Round 1) | dev / holdout |
| `plugin-holdout-d8aa0b1.json`, `plugin-holdout-042cf4c.json` | `eval/plugin.mjs --split holdout --runs 3 --max-usd 5`, recovered (below) | holdout |
| `run-holdout-fa22e81.json`, `run-dev-ac67ad5.json` | `eval/run.mjs --runs 3 --json`, recovered (below) | holdout / dev |
| `superseded/` | runs replaced by a re-run on a clean tree; see its README | — |

## Recovered from archive tags (2026-09-25)

On 2026-09-24 two Claude Code sessions worked from commit `2cf4eba` on branches that were later
deleted after being saved as tags. Their completed runs were never merged, so `main` said the
plugin holdout comparison had never run. The files were brought back **byte for byte** (the git
blob hash of each copy equals the original's), renamed only so the two plugin runs, which had the
same file name, can sit side by side:

| File here | Original path | Commit | Tag | Blob |
| --- | --- | --- | --- | --- |
| `plugin-holdout-d8aa0b1.json` | `eval/results/plugin-holdout.json` | `d8aa0b1d22dac3d5347e88e6e51cb06cc9dd1151` | `archive/claude/plugin-holdout` | `3184f377` |
| `plugin-holdout-042cf4c.json` | `eval/results/plugin-holdout.json` | `042cf4c1937dd2cd48499b947182979e57fd203e` | `archive/main-rggfgw` | `f4b777d9` |
| `run-holdout-fa22e81.json` | `eval/results/run-holdout.json` | `fa22e81774fa854267c3065a7296acde86ff1717` | `archive/main-rggfgw` | `e4ef2efa` |
| `run-dev-ac67ad5.json` | `eval/results/run-dev.json` | `ac67ad54e8d74ad23ed87862d2d230781b2089df` | `archive/main-rggfgw` | `e6d8d2e7` |

- **The two plugin runs** both ran the preregistered command (PREREGISTRATION.md, step 4) on the
  same code (`2cf4eba`), in two separate sessions at about the same time, and both confirmed the
  hook scored with Jev on every task and run (`pluginRun.scorer` is `jev` in all 18 context rows of
  each file). Neither was designated in advance as *the* run, so both are reported, in full.
  Their commit messages record the Claude API spend as $4.23 (`d8aa0b1`) and $4.10 (`042cf4c`);
  the files keep per-row cost for the agent runs only.
- **The two retention runs** are the old `run.mjs --json` output (no `commit` or `jevUsage`
  fields; those were added in Round 1). They are further runs of the same measure as
  `retention-{dev,holdout}.json`, and differ from them only because Jev's answers vary between
  calls.
