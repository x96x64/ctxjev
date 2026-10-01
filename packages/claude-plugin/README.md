# ctxjev for Claude Code

**Hands the highest-scoring entries of your session back to Claude Code right after it compacts.**

[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

Claude Code compacts a long conversation by summarizing it. That's necessary to keep going, but a
summary is lossy by nature. The detail that mattered most (the exact line that turned out to be
the bug, the one command whose output actually mattered) can get smoothed away along with
everything that didn't.

`ctxjev` scores your session's history against your goal right before compaction happens, by
keyword overlap on your own machine (or, if you opt in, with [Jev](https://typesafe.ai), a fast,
cheap, typed-decision model), and caches whatever scored highest. The moment compaction finishes, it hands that cache back to Claude
Code as a reminder. Nothing about the compaction itself changes; the few entries that scored highest
are put back in front of the model whether or not the summary kept them.

No configuration is required: it activates automatically once installed. Set an explicit goal
with `/ctxjev:set-goal` when you want scoring aimed at something more specific than your first
request plus your latest instruction.

<!-- checked-prose -->
**What it's shown so far: no demonstrated effect.** In the [plugin eval](../../docs/evaluation.md),
against a simulated compaction summary that already keeps every user instruction, the digest added
<!-- generated:plugin-diff -->+5 points [0, +15]<!-- /generated:plugin-diff --> to tasks passed on
the tasks it was designed on: within the noise. The
[preregistered](../../packages/core/eval/PREREGISTRATION.md) comparison on <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> unseen tasks ran to
completion in <!-- generated:plugin-run-count -->two<!-- /generated:plugin-run-count --> runs, and the digest's difference in tasks passed, in points with a 95% CI for each, was
<!-- generated:plugin-holdout-inline -->run `d8aa0b1` −6 [−17, 0] with the inferred goal and 0 [0, 0] with the set goal; run `042cf4c` −17 [−39, 0] with the inferred goal and −11 [−22, 0] with the set goal (point estimates at or below zero in every one)<!-- /generated:plugin-holdout-inline -->:
none clears zero, so it has no demonstrated effect there either. Whether it helps depends on
how much Claude Code's real compaction drops, which neither eval can measure.
<!-- /checked-prose -->

## How It Works

Claude Code hooks can *read* the conversation but cannot rewrite it, so this plugin doesn't try to
intercept compaction. It works alongside it instead, using the one mechanism Claude Code actually
provides for this:

```
PreCompact          → score every entry against your goal, cache the highest-scoring few
  (Claude Code's own compaction runs, untouched, exactly as it always does)
SessionStart(compact) → read that cache, print a short digest; Claude Code adds it back as
                        a system reminder, right as the new, compacted session begins
```

Scoring runs against whichever goal is active: an explicit one you set with `/ctxjev:set-goal`,
or, if you never set one, your first request plus your latest instruction, both read from the
session's own transcript, so the original request still counts after several compactions. Text
Claude Code writes into the conversation itself (local command output, interrupt notices, a
skill's expanded instructions) is never taken for your request. Scoring is keyword overlap by
default (`ctxjev-core`'s `scorer: 'local'`), ranked within the session the same way `ctxjev
analyze --scorer local` ranks it, so a score in the digest means the same as one in the CLI; only
entries that share at least one word with the goal are kept. `CTXJEV_SCORER=jev` switches to the
Jev judgment [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp) exposes.

## Skills

- **`/ctxjev:set-goal <text>`** points scoring at something specific. Useful the moment your
  session's focus shifts, or before a compaction you know is coming. Nothing is written anywhere:
  the command is recorded in the session's transcript, and that's what the next compaction reads.
  So it applies to that session only (another session open on the same project keeps its own),
  lasts through compactions, and the latest one wins.
- **`/ctxjev:status`** shows the goal the next compaction will use, what the last compaction's run
  actually did, including *why* if it skipped or failed (nothing to score, or, with Jev opted into,
  a missing API key or a failed Jev request), and every preserved entry with its score,
  highest first. The fastest way to check the plugin is working. It's answered by a hook before
  your prompt reaches Claude, so checking never starts a model turn (or any work).

Five entries are preserved per compaction by default; set `CTXJEV_PRESERVE_LIMIT` (1–50) in the
environment Claude Code runs in to change that.

## Install

**From the Claude Code desktop app or CLI:**

```
/plugin marketplace add x96x64/ctxjev
```

```
/plugin install ctxjev@ctxjev-plugins
```

From a terminal, `claude plugin marketplace add x96x64/ctxjev` and `claude plugin install
ctxjev@ctxjev-plugins` do the same. The marketplace installs the plugin from the repository at the
latest release's tag. `/ctxjev:set-goal` and `/ctxjev:status` are available right after.

**To develop against the plugin's own source** (this repo, not the installed copy):

```bash
git clone https://github.com/x96x64/ctxjev.git
cd ctxjev && pnpm install && pnpm build
claude --plugin-dir packages/claude-plugin
```

## Requirements

Nothing beyond Node.js, which Claude Code already needs. By default the plugin scores offline by
keyword overlap and sends nothing anywhere. That's the default because on the preregistered
holdout sessions Jev's ranking kept less of what a task needed than keyword overlap (and than a
random order), and the Jev-scored digest showed no demonstrated effect there (see the
[evaluation](../../docs/evaluation.md)); offline, your session also stays on your machine.
Nor has the offline digest been shown to help: neither scorer has a demonstrated effect.

**Optional, Jev:** set `CTXJEV_SCORER=jev` and a [Jev](https://typesafe.ai) API key as
`TYPESAFE_API_KEY` (from [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys),
no waitlist) in the environment Claude Code itself runs in. If the key is missing, a request fails,
or Jev takes more than 20 seconds, the plugin falls back to offline scoring and `/ctxjev:status`
says why, so compaction is never held up for long. A bug here can never block your actual
compaction. That's by design, not a side effect.

The Claude Code desktop app doesn't inherit variables exported in your shell profile. If
`/ctxjev:status` reports the key missing even though your terminal has it, set both where the app
can see them, for example with `launchctl setenv` on macOS, then restart the app.

## What the plugin sends and keeps

**By default nothing leaves your machine**: scoring is local keyword overlap. The rest of this
section applies only if you set `CTXJEV_SCORER=jev`. Then, on every compaction, the plugin sends
excerpts of your real session (your messages, Claude's replies, and tool calls with their output)
to TypeSafe AI's Jev API for scoring.

- **Secrets are masked first, on a best-effort basis.** Common key formats (Anthropic/OpenAI
  `sk-…`, GitHub tokens, AWS access keys, Slack tokens, JWTs, bearer tokens, private-key blocks,
  payment card numbers), passwords in URLs, and the value of anything assigned to a name like
  `API_KEY`, `SECRET`, `TOKEN`, or `PASSWORD`
  are replaced with `[REDACTED]` before sending, and tool names are masked the same way. Entry ids
  aren't sent at all. That narrows exposure; it can't recognize every possible secret.
- **Only short excerpts are sent**, not whole files or full tool output.
- **Nothing is written into your project.** Scores and excerpts go to
  `~/.claude/ctxjev/sessions/<session id>/` (under `CLAUDE_CONFIG_DIR` if you set it), readable only
  by you, one directory per session, and only the 50 most recent sessions are kept. If a version
  before 0.6.0 left a `.ctxjev/` directory in your project, the next compaction removes the files it
  wrote there, and the directory too if nothing else is in it.
- **Nothing is sent unless you opt in.** Without `CTXJEV_SCORER=jev`, or with it but no
  `TYPESAFE_API_KEY`, nothing leaves your machine.

Why hooks can't do this the "obvious" way, and the other design choices, are in the
[design notes](../../docs/design-notes.md).

## Bundled code

The hooks in `dist/` bundle code from `@typesafe-ai/sdk` (MIT); its license text and copyright
notice are in [`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES), which the build generates from what it
bundled. It and [`LICENSE`](LICENSE) are in this directory, so a marketplace install carries both.

<!-- shared:about -->
## About ctxjev

ctxjev scores an AI agent's history and decides what to keep, drop, or summarize. One engine comes
four ways:

| Package | What it is | Sends anything by default? |
| --- | --- | --- |
| [`ctxjev-core`](https://www.npmjs.com/package/ctxjev-core) | The library: `pruneMessages()`, `pruneContext()`, and the scorers | No |
| [`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli) | `ctxjev analyze` and `ctxjev prune` in a terminal | No |
| [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp) | `score_relevance` and `prune_history` as MCP tools, for Claude Code, Codex, and other hosts | No: only a call that passes `scorer: "jev"` |
| [Claude Code plugin](../claude-plugin/README.md) | Hands the highest-scoring entries back right after Claude Code compacts | No |

Scorers: `recency` (plain truncation: newest kept), `local` (keyword overlap with your goal), and
`jev` (TypeSafe AI's [Jev](https://typesafe.ai), opt-in, needs `TYPESAFE_API_KEY`). Full docs are in
the [ctxjev repository](../../README.md).
<!-- /shared:about -->

<!-- shared:privacy -->
## Privacy

- With `recency` or `local`, nothing is sent anywhere.
- With `jev`, the goal and a short excerpt of each entry are sent to TypeSafe AI's Jev API, after
  common secret formats are replaced with `[REDACTED]` and without entry ids. The masking is
  pattern matching: it narrows exposure but can't recognize every secret.
- Without a usable `TYPESAFE_API_KEY` (unset, blank, or an unexpanded placeholder such as
  `${TYPESAFE_API_KEY}`), nothing is sent, and whatever asked for Jev says so.

How well the masking works is measured in the [evaluation](../../docs/evaluation.md#secret-masking-measured-blind).
To report a leak, see the [security policy](../../SECURITY.md).
<!-- /shared:privacy -->

<!-- shared:status -->
## Status and limits

<!-- checked-prose -->
Whether pruning this way helps an agent finish its work hasn't been shown. In a preregistered
comparison on <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> tasks the design had never seen, Jev's ranking and plain truncation
gave the same task success (difference in percentage points, with its 95% CI:
<!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku --> with Claude Haiku 4.5, <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet --> with Claude Sonnet 5). On the
preregistered measure of what each task needed, Jev's ranking kept <!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev --> under a tight budget, less
than a random ordering of the same entries (<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->), and the Claude Code plugin's digest had no
demonstrated effect. The [evaluation](../../docs/evaluation.md) has
every number and what it can't show.
<!-- /checked-prose -->
<!-- /shared:status -->

<!-- shared:license -->
## License

[MIT](LICENSE). ctxjev is an independent project, not affiliated with or endorsed by TypeSafe AI
or Anthropic.
<!-- /shared:license -->
