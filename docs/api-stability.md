# API stability

From 1.0.0, ctxjev follows [Semantic Versioning](https://semver.org): within 1.x, what this page
lists as **stable** keeps working as described, and only a 2.0.0 may break it. Everything it lists
as **not covered** can change in any release. If something isn't on this page, it isn't covered.

The four packages share one version number (they are released together), so a breaking change to
any of them is a major release of all of them.

## Stable

### `ctxjev-core` (the main entry point, `import … from 'ctxjev-core'`)

**Functions**

| Function | Promise |
| --- | --- |
| `scoreEntries(entries, goal, recencyWeight?, options?)` | Returns one `ScoredEntry` per entry, in order. |
| `pruneContext(entries, goal, policy?, options?)` | Returns one `PruneDecision` per entry, in order. |
| `pruneMessages(messages, goal, options?)` | Returns a `PruneMessagesResult` whose `messages` is still a valid Anthropic Messages request: a `tool_use` and its `tool_result` are removed together; the first message and, with `protectLastTurn`, the latest turn are never touched. |
| `messagesToEntries(messages)` | The entries `pruneMessages()` scores. |
| `pruneEntries(entries, decisions, options?)` | Applies decisions to an entry list. |
| `summarizeSavings(entries, decisions)` | A `SavingsReport`. |
| `estimateTokens(text)` | An estimate (it uses `gpt-tokenizer`, not Claude's tokenizer); the exact numbers aren't promised. |
| `redactSecrets(text)` | Masks secrets to `[REDACTED]`. Which strings it masks is **not** covered: it's best-effort, and every release may mask more (or, to fix a false alarm, less). |
| `parseClaudeCodeTranscript(jsonl, options?)`, `resolveClaudeCodeGoal(jsonl, entries)` | Read a Claude Code session log. Claude Code's log format isn't documented, so a change in Claude Code can change what these return; ctxjev follows it in a minor or patch release. |
| `typesafeApiKey(env?)`, `missingTypesafeApiKey(env?)` | Whether a usable Jev key is set; a value that's only an unexpanded placeholder is none. The wording of the reason isn't covered. |
| `localRelevance(goal, content)` | Keyword overlap from 0 to 1. |

**Types and constants:** `Entry`, `EntryRole`, `PruneAction`, `ScoredEntry`, `PruneDecision`,
`PruningPolicy`, `DEFAULT_POLICY`, `JevUsage`, `ScoreEntriesOptions`, `CustomScorer`, `ScoreCache`,
`JevClient`, `AnthropicMessage`, `AnthropicContentBlock`, `PruneMessagesOptions`,
`PruneMessagesResult`, `KeptDrops`, `PruneEntriesOptions`, `PruneEntriesResult`, `EntryKeptDrops`,
`SavingsReport`, `ParseClaudeCodeTranscriptOptions`, `ClaudeCodeGoal`. Their field names, types,
and meanings are stable; a minor release may add an optional input field or a new output field.

**Defaults** (changing one is a breaking change):

| Default | Value |
| --- | --- |
| `scorer` (`scoreEntries`, `pruneContext`, `pruneMessages`) | `'recency'` |
| `DEFAULT_POLICY` | `dropBelow` 0.3, `summarizeBelow` 0.6, `recencyWeight` 0.1 |
| `pruneMessages()` | `protectLastTurn` true, `protectLast` 2, `keepUserText` true, `marker` true, `minSavedTokens` 0, no `targetTokens`, no `summarize` |
| `pruneEntries()` | `protectFirstUserEntry` true, `protectLast` 2 |

**Result fields worth naming:** `ScoredEntry`'s `relevance`, `recency`, `combinedScore`, and `tied`
(present, as `true`, only when every entry ties under `'local'`); `PruneMessagesResult`'s `removed`,
`summarized`, `savedTokens`, `cache`, `overBudget`, `heldBack`, `keptDrops` (its six lists), and
`noteOmitted` (always set by `pruneMessages()`; optional in the type only so a result built by hand
still compiles).

**What a scorer sends:** only `'jev'` sends anything (the goal and masked excerpts, to TypeSafe AI's
Jev API, never entry ids). `'recency'`, `'local'`, and a `CustomScorer` send nothing themselves. Any
change to what is sent, or when, is a breaking change.

### `ctxjev-cli`

- **Commands:** `ctxjev analyze <transcript>` and `ctxjev prune <transcript>`.
- **Flags:** `--goal`, `--drop-below`, `--summarize-below`, `--scorer` (`recency`, the default;
  `local`; `jev`), `--offline`, `--json`, `--no-cache`, `--out`, `--protect-last`,
  `--no-protect-first`, `--no-protect-last-turn`, `--target-tokens`, `--summarize-excerpts`,
  `--drop-user-text`, `--no-marker`, `--min-saved-tokens`, `--help`/`-h`, `--version`/`-v`, with
  the defaults the [CLI README](../packages/cli/README.md) lists.
- **Exit codes:** 0 on success (`--help` and `--version` included), non-zero on any error. Distinct
  non-zero codes aren't promised.
- **Input formats:** ctxjev's own JSON, an Anthropic Messages conversation (bare or as
  `{ goal?, messages }`), and a Claude Code session `.jsonl` (analyze only), detected automatically.
- **`analyze --json` output:** the fields `decisions`, `savings`, `usage`, `scorer`, and `prune`, as
  the CLI README describes them. A new field may appear in a minor release.
- **What `prune` writes:** the input file's own structure with the removed entries gone and every
  other field as it was.

### `ctxjev-mcp`

- **Tools:** `score_relevance` and `prune_history`.
- **Inputs:** `goal`, `entries` (`{ id, role, toolName?, content, timestamp, sourceTokens? }`),
  `scorer` (`local`, the default from 1.0; `recency`; `jev`), `recencyWeight`, and for
  `prune_history` also `dropBelow` and `summarizeBelow`, with the limits the schemas state (500
  entries, 4,000 characters of content, 2,000 of goal). An argument a tool doesn't take is an error.
- **Outputs:** `score_relevance` returns `{ scored, usage }`; `prune_history` returns
  `{ decisions, savings, usage }`, with the fields of the matching `ctxjev-core` types.
- **What is sent:** nothing, unless a call passes `scorer: "jev"`.

### The Claude Code plugin

- **Hooks:** `PreCompact` (score and cache), `SessionStart` with `matcher: "compact"` (print the
  digest), and `UserPromptSubmit` (answer `/ctxjev:status`).
- **Skills:** `/ctxjev:set-goal <text>` and `/ctxjev:status`.
- **Environment variables:** `CTXJEV_SCORER` (`jev` opts in; anything else is offline),
  `CTXJEV_PRESERVE_LIMIT` (1 to 50, default 5), `CTXJEV_STATE_DIR` (default `~/.claude/ctxjev`),
  and `TYPESAFE_API_KEY`.
- **Where state lives, and how it's protected:** under the state directory, one directory per
  session, never in your project; directories 0700 and files 0600; secrets masked before anything is
  written.

### Codex

The Agent Plugins bundle in `plugins/ctxjev/` registers `ctxjev-mcp` and passes `TYPESAFE_API_KEY`
through. What Codex gets is what `ctxjev-mcp` promises above.

## Not covered

- **`ctxjev-core/internal`.** Helpers the ctxjev packages share among themselves (`truncate`,
  `atomicWriteFile`, `seededRandom`, `validateEntries`, `rankLocalRelevance`, and the rest). Any of
  them can change or go in any release.
- **Files inside a package.** The `dist/` layout, file names, and source maps; `ctxjev-core`'s
  `exports` map refuses imports by path.
- **Human-readable output.** The CLI's report, warnings, and error messages; the MCP tools' error
  text; the plugin's digest and `/ctxjev:status` report. Read `analyze --json` and the MCP tools'
  results instead.
- **File formats ctxjev writes for itself.** The CLI's score cache
  (`~/.cache/ctxjev/score-cache.json`) and the plugin's `preserved.json` and `last-run.json`. They
  may change shape, and ctxjev may discard an old one rather than read it.
- **Which secrets `redactSecrets()` masks**, and the exact token counts `estimateTokens()` gives
  (see above).
- **Scores.** The numbers a scorer returns for a given input may change with a better heuristic,
  and Jev's answers vary between runs. The scale (0 to 1) and the decision rule are stable; the
  values aren't.
- **`CTXJEV_JEV_TIMEOUT_MS`.** It lowers the plugin's Jev timeout for tests and evals; it isn't a
  supported setting.
- **The evaluation harness** (`packages/core/eval/`, `examples/`), the repository's scripts, and CI.

## Node.js

The packages need Node.js 20 or later (`engines`). A Node.js version whose official support has
ended may stop being supported in a minor 1.x release; the CHANGELOG says so when it happens. A
version that is still supported is never dropped outside a major release.

## Deprecation

- Something stable that's going away is first marked deprecated in a minor release: the CHANGELOG
  says so, the README and type documentation say what to use instead, and, where it can, ctxjev
  warns once at run time.
- It keeps working for the rest of 1.x and is removed no earlier than 2.0.0.
- A security fix is the one exception: if keeping a behavior would leak data, it can change in a
  patch release, and the CHANGELOG says why.
