# Superseded runs

Kept so every number the Round 1 changes record (docs/audits/2026-09-25-round-1-changes-ja.md)
discloses is backed by a saved file. **Don't cite these as results; cite `../retention-*.json`.**

`retention-{dev,holdout}-precommit.json` came from `node eval/run.mjs --gate --runs 3 --split dev`
and `--runs 3 --split holdout`, with `--out`, on 2026-09-24, minutes before the saved runs in
`../`. The code was commit 630072e minus the lines that record `uncommittedChanges`: run.mjs's
`--out`, usage, and exploratory changes were not yet committed, so the `commit` field (f7fd254,
the parent) doesn't describe the code that ran, and the files have no `uncommittedChanges` field.
They were re-run from 630072e on a clean tree so the saved files' provenance is exact; Jev's answers
vary between calls, so the two sets differ.
