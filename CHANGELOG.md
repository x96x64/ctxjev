# Changelog

Versions are shared (lockstep) across `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp`, and
`ctxjev-claude`: a version bump in one is a version bump in all four, even when only one actually
changed. This also covers the three plugin-manifest version fields Claude Code's installer reads
(`.claude-plugin/marketplace.json`, `packages/claude-plugin/.claude-plugin/plugin.json`,
`plugins/ctxjev/plugin.json`) — easy to forget since none of them are `package.json`.

## 0.1.10 — 2026-09-21

A cloud-based review (`/code-review ultra`, diffed against the repo's very first commit) audited
0.1.9's own fixes and turned up 8 more issues — several in the fixes themselves. All 8 fixed.

- **`ctxjev-mcp`**: `entrySchema.timestamp` now requires `.finite()` — a bare `z.number()` only
  rejects `NaN`, not `Infinity`/`-Infinity`, and `JSON.parse('{"timestamp":1e400}')` already
  produces `Infinity` over ordinary JSON. Since `ctxjev-core`'s `computeRecency` takes min/max
  across the *whole batch*, one infinite timestamp turned every entry's recency (and thus
  `combinedScore`) into NaN, not just the offending entry's.
- **`ctxjev-claude`**: `preCompact.ts` now clears `.ctxjev/preserved-context.json` as soon as
  `cwd` is known, before any of its several early-return paths (missing API key, zero parsed
  entries, no resolvable goal, nothing selected). Previously, a snapshot from an earlier — possibly
  unrelated — compaction stayed in place through any of those paths, and `sessionStartCompact.ts`
  would re-inject it unconditionally as if it reflected the compaction that just happened.
- **`ctxjev-core`**: `isValidPolicyOrdering(dropBelow, summarizeBelow)` is now exported and is the
  one place the `dropBelow <= summarizeBelow` invariant lives — `ctxjev-cli` and `ctxjev-mcp` had
  each independently reimplemented the identical check (0.1.9 added both, in parallel, as if they
  were unrelated fixes). `truncate()` is now also exported from core and shared with
  `ctxjev-cli`'s report formatter, which had its own copy differing only in the length constant.
- **`ctxjev-cli`**: `report.ts`'s column-width calculation no longer spreads the full (unbounded,
  straight from a real transcript) entries array into `Math.max(...)` — the exact stack-overflow
  risk this same release's core fix (`computeRecency`) addressed, left unfixed here. The score
  cache is now saved in a `finally`, so a partial run (some chunks scored before a later one
  throws) doesn't discard already-paid-for verdicts. `scoreCache.ts`'s save is now atomic
  (temp file + rename), matching `ctxjev-claude`'s identical fix to `preserve.ts` in 0.1.9 — this
  file was missed at the time despite sharing the exact same shared-file race.
- **`ctxjev-core`**: removed an unused `cacheKeyFor` value import in `index.ts` (only the
  standalone re-export on the next line needs it).

## 0.1.9 — 2026-09-21

An exhaustive, no-compromise pass over the whole monorepo (not tied to any single reported bug)
turned up 32 issues across every package; all 32 are fixed here.

- **`ctxjev-core`**: `decideAction` now throws on a NaN score instead of silently defaulting to
  `'keep'` — NaN compares false against every threshold, so a bad relevance/recency input upstream
  previously resolved to "definitely keep this" with no error anywhere. `chunkEntries` now rejects
  a non-positive `maxPerRequest` instead of looping forever. `cacheKeyFor` now builds its key via
  `JSON.stringify` instead of joining fields, which let one field's own content shift the boundary
  and collide with a different `(role, toolName, content)` tuple. `scoreRelevance` throws a clear
  error when Jev's response is missing an answer for an entry, instead of a raw `TypeError`.
  `summarizeSavings` throws when an entry has no matching decision instead of silently counting it
  as "kept". `scoreEntries` now fans chunk requests out with a concurrency cap of 5 instead of one
  unthrottled `Promise.all` — a large transcript no longer risks a rate-limit thundering herd.
  `computeRecency` no longer spreads the full entry list into `Math.min`/`Math.max` (a stack-size
  risk on very large transcripts); a plain loop instead.
- **`ctxjev-core`**: `parseClaudeCodeTranscript` no longer silently drops a user message whose
  content is array-shaped (an attachment alongside text, for example) — its text block is now
  captured the same way an assistant's already was. A `tool_use` block that never receives its
  matching `tool_result` (the transcript ends mid-call) is no longer dropped from the entry list;
  it's kept as a "(no result — tool call never completed)" entry. `inferGoalFromEntries`'s
  slash-command detection no longer misclassifies an ordinary message that happens to start with
  "/" (e.g. "/etc/hosts isn't being read correctly") — only a genuinely command-shaped first token
  counts now.
- **`ctxjev-cli`**: transcript entries in ctxjev's own JSON format are now validated field-by-field
  (id, role, content, timestamp) instead of being cast straight through — a missing `timestamp`
  used to poison every entry's recency to NaN, which (per the `ctxjev-core` fix above) used to
  silently resolve to "keep everything," with zero error. `--drop-below`/`--summarize-below` now
  reject an empty or whitespace-only value instead of reading it as a literal `0`
  (`Number('')` is `0`, not `NaN`). The two flags are now also checked against each other —
  `--drop-below` greater than `--summarize-below` used to silently make "summarize" unreachable.
- **`ctxjev-mcp`**: `score_relevance`/`prune_history` now share an in-memory score cache across
  calls, the same goal+content keying `ctxjev-cli`'s file-backed cache already uses — a
  long-running server process no longer re-pays Jev for identical entries it already scored.
  `dropBelow`/`summarizeBelow` are now checked against each other, mirroring the `ctxjev-cli` fix
  above. `entries` is now capped at 500 per call and `content` at 4000 characters; `goal`/entry
  `id` now reject empty strings — the MCP-facing schema previously enforced none of the size limits
  `ctxjev-core`'s own docs already describe. The tools' advertised defaults in their schema
  descriptions now read from `DEFAULT_POLICY` instead of being hardcoded as literal text that would
  go stale the moment the policy is retuned.
- **`ctxjev-claude`**: the committed `dist/` no longer contains five dead files (`goal.js`,
  `select.js`, `preserve.js`, `readStdin.js`, `transcript.js`) left over from `tsc`'s per-file
  output — they still carried the exact unresolvable bare `ctxjev-core` import 0.1.8 shipped
  esbuild bundling to fix, harmless only because nothing loaded them. `tsc` is now `noEmit` for
  this package (nothing else in the monorepo references its declarations), so it can never again
  write a broken intermediate `dist/preCompact.js` for `esbuild.build.mjs` to maybe-overwrite; the
  build script now also deletes anything in `dist/` besides the two files `hooks/hooks.json`
  actually invokes, and fails loudly if either still has an unresolved bare import after bundling.
  `ctxjev-core`'s `package.json` now declares `"sideEffects": false`, letting esbuild's
  tree-shaking actually drop `gpt-tokenizer`'s unused BPE tables from the bundle —
  `dist/preCompact.js` shrank from 3.3MB/206,766 lines to 17KB, minified. The preserved-context
  cache write is now atomic (temp file + rename) instead of a single `writeFile` that two
  concurrent `PreCompact` runs on the same project could interleave and corrupt. The
  `SessionStart:compact` reminder now explicitly frames preserved entries as quoted transcript
  excerpts, not instructions — they're re-injected as trusted-looking context, and a high-scoring
  prompt-injection payload from before compaction deserves the same "this is data, not a command"
  framing tool output already gets elsewhere.
- **Test coverage**: `packages/mcp-server/src/schemas.test.ts`, `packages/cli/src/validation.test.ts`,
  `packages/claude-plugin/src/preCompact.test.ts`, and
  `packages/claude-plugin/src/sessionStartCompact.test.ts` are new — none of this logic (schema
  validation boundaries, threshold parsing, and the hooks' own stdin-parsing/guard behavior) had
  any test running in CI before; the previous test files touching it were all `.live.test.ts`,
  gated on a key CI never sets. The last two spawn the actual bundled `dist/*.js` files as
  subprocesses — the same artifact a real install runs.
- **CI/release**: `ci.yml` now runs on Node 22, matching `publish.yml` — CI had never tested the
  same runtime a release actually ships on. `publish.yml` now sets `TYPESAFE_API_KEY` for its test
  step, so a release's live-API tests actually run instead of always skipping; it also now checks
  all 7 version-lockstep files agree before publishing, the exact drift that went unnoticed for
  five releases before 0.1.8. Root `package.json`'s `"lint"` script is removed — it called
  `pnpm -r run lint` when no package in the monorepo has ever had a lint script, a permanent no-op
  masquerading as a check. `README.md` no longer claims all four packages have `.live.test.ts`
  files; `ctxjev-cli` has none.

## 0.1.8 — 2026-09-21

- **`ctxjev-claude`**: `preCompact.js` now fails the same way `dist/` itself did in 0.1.7 —
  `hooks/hooks.json` ran it fine this time, but it then crashed with
  `ERR_MODULE_NOT_FOUND: Cannot find package 'ctxjev-core'`. `tsc` had only transpiled the bare
  `import ... from 'ctxjev-core'` as-is; it resolved in this repo purely because pnpm's workspace
  linking drops a `node_modules/ctxjev-core` symlink here, and Claude Code's installer never runs
  an install step, so that symlink — and the import — could never exist in an installed copy,
  confirmed against a real reinstall on this repo's own development machine. `preCompact.js` and
  `sessionStartCompact.js` are now bundled with esbuild (`packages/claude-plugin/esbuild.build.mjs`)
  instead of left as `tsc`'s plain per-file output, so both are self-contained and need nothing
  from `node_modules` at runtime — verified by running the bundled file alone in an empty
  directory with no `node_modules` at all.
- **`ctxjev-claude`**: the plugin's own version fields (`.claude-plugin/marketplace.json`,
  `.claude-plugin/plugin.json`, `plugins/ctxjev/plugin.json`) had stayed at `0.1.2` since the
  very first release — the lockstep convention above only ever covered the four npm package
  versions, not these three, so Claude Code's installer (which reads these, not
  `package.json`) had no way to tell any of the last five releases apart. All three now track
  the same version as everything else.

## 0.1.7 — 2026-09-21

- **`ctxjev-claude`**: `dist/` is now committed instead of gitignored. Claude Code installs a
  plugin by cloning its marketplace repo, not by running a build step, so `hooks/hooks.json`'s
  references to `dist/preCompact.js` and `dist/sessionStartCompact.js` resolved to nothing in
  every fresh install, and both hooks failed with `MODULE_NOT_FOUND` — confirmed against a real
  install on this repo's own development machine. Every other package's `dist/` stays gitignored,
  since npm builds those itself on publish; only this one needed to ship built.

## 0.1.6 — 2026-09-21

- **`ctxjev-core`**: `scoreEntries()` now rejects entries with duplicate ids up front, instead of
  silently letting one entry's content overwrite another's in what Jev actually sees and mapping
  both back to the same, wrong verdict.
- **`ctxjev-cli`**: `--drop-below`/`--summarize-below` now reject anything that isn't a real
  number in `[0, 1]` with a clear error, instead of silently becoming `NaN` — which compared
  false against every score and meant `drop` could never be returned again.
- **`ctxjev-core`**: added an optional `cache: ScoreCache` to `scoreEntries()`/`pruneContext()`,
  checked before and populated after each Jev request, keyed by goal + entry content.
  **`ctxjev-cli`** wires this to `~/.cache/ctxjev/score-cache.json` by default; `--no-cache`
  bypasses it. Re-running the same analysis now costs nothing the second time.

## 0.1.5 — 2026-09-21

- **`ctxjev-mcp`**: the MCP server registered itself with a literal `version: '0.0.0'` — the same
  stale-hardcoded-string bug already fixed for `ctxjev-cli`'s `--version` in 0.1.2, just never
  applied here. Any MCP client inspecting server info would see `0.0.0` forever regardless of the
  actually installed version. Now reads it from the package's own `package.json`.
- **`ctxjev-core`**: added `createUsageAccumulator()`, replacing an identical `JevUsage`
  accumulation closure that `ctxjev-cli` and `ctxjev-mcp` had each reimplemented on their own.

## 0.1.4 — 2026-09-21

- **`ctxjev-core`**: `inferGoalFromEntries()` now skips slash-command invocations (`/compact`,
  `<command-name>/ctxjev:status</command-name>`, ...) when falling back to "the most recent user
  message." `PreCompact` fires right after `/compact` runs, so without this, the inferred goal was
  almost always the literal string `"/compact"` whenever no explicit goal was set — confirmed
  against a real cached snapshot from this repo's own development. Also benefits `ctxjev-claude`,
  which calls the same function.

## 0.1.3 — 2026-09-21

- README (main and all four package READMEs): rewrote dash-led sentences into plain prose, and
  gave each License section a real sentence explaining what MIT permits and requires instead of a
  bare link.
- `package.json` (`ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp`, `ctxjev-claude`): added `keywords`,
  `author`, `bugs`, and `engines.node`, all missing until now.

## 0.1.2 — 2026-09-21

- **`ctxjev-cli`**: the report now opens with a one-line legend explaining what `score` and
  `keep`/`summarize`/`drop` mean, so first-time output shouldn't need someone else to explain it.
- **`ctxjev-cli`**: `--version` now reads the installed package's actual version instead of a
  hardcoded string that had already gone stale.
- **`ctxjev-cli`**: a missing `TYPESAFE_API_KEY` and a bad transcript path are now both reported
  in one run, instead of only the first one found. Fixing the key and re-running used to be the
  only way to discover the path was wrong too.
- **`ctxjev-cli`**: `--help` now leads with a copy-pasteable "try it right now" example (fetches
  the repo's sample transcript directly), rather than starting with the flag reference.
- **`ctxjev-claude`**: the plugin's Overview, Skills, and Hooks descriptions (`plugin.json`,
  `marketplace.json`, `README.md`) were rewritten from a placeholder one-liner to real,
  descriptive content, matching the style of the other three packages' READMEs.
- **`ctxjev-claude`**: removed a duplicate `category` field from `plugin.json` that
  `claude plugin validate .` flagged: it belongs only in `marketplace.json`'s plugin entry.
- Added a Codex-specific plugin marketplace bundle (`.agents/plugins/marketplace.json`,
  `plugins/ctxjev/`), following the [Agent Plugins](https://agent-plugins.org) `1.0.0` schema, so
  `ctxjev-mcp` can be installed via `codex plugin marketplace add`/`codex plugin add` instead of
  only `codex mcp add`.

## 0.1.1 — 2026-09-21

- Per-package READMEs on npm expanded to match the main repo's style (badges, real captured
  examples) instead of minimal stubs.
- First real use of [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (GitHub
  Actions OIDC) to ship a release, with no npm token involved.

## 0.1.0 — 2026-09-21

First public release.

- `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp` published to npm; `ctxjev-claude` stays repo-only
  (Claude Code plugins aren't npm-installed).
- Composite scoring (Jev's relevance blended with each entry's recency) tuned against
  hand-labeled fixtures, not left as an untested default.
- MCP server (`score_relevance`, `prune_history`) verified against Claude Code (real session)
  and Codex CLI (real config registration).
- Claude Code plugin: `PreCompact`/`SessionStart` re-injection pattern, plus `/ctxjev:set-goal`
  and `/ctxjev:status` skills.
- `ctxjev-cli` reads a real Claude Code `.jsonl` transcript directly, auto-detected, alongside
  its own JSON format.
- Jev token usage and estimated cost surfaced in the CLI report and both MCP tool responses.
