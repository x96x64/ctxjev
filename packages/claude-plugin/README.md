<div align="center">

# ctxjev

**Keep what matters through Claude Code's own compaction.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![Verified](https://img.shields.io/badge/verified-desktop%20app%20%2B%20CLI-brightgreen)](../../ROADMAP.md)

[Overview](#overview) · [How It Works](#how-it-works) · [Skills](#skills) · [Install](#install) · [Requirements](#requirements) · [Privacy](#privacy)

</div>

---

## Overview

Claude Code compacts a long conversation by summarizing it. That's necessary to keep going, but a
summary is lossy by nature. The detail that mattered most (the exact line that turned out to be
the bug, the one command whose output actually mattered) can get smoothed away along with
everything that didn't.

`ctxjev` scores your session's history with [Jev](https://typesafe.ai), a fast, cheap,
typed-decision model rather than a text-generating one, right before compaction happens, and
caches whatever scored highest. The moment compaction finishes, it hands that cache back to Claude
Code as a reminder. Nothing about the compaction itself changes; what changes is that the few
things that mattered most don't have to survive being summarized to still be there.

No configuration is required to start benefiting from it: it activates automatically once
installed. Set an explicit goal with `/ctxjev:set-goal` when you want scoring aimed at something
more specific than "whatever you last said."

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
or, if you never set one, your most recent message, inferred automatically. Either way, this is
the same relevance judgment [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp) and
[`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli) expose elsewhere, applied here at exactly
the moment it matters most.

## Skills

- **`/ctxjev:set-goal <text>`** points scoring at something specific instead of guessing from your
  last message. Useful the moment your session's focus shifts, or before a compaction you know is
  coming. Applies to the current session only — a goal left over from an earlier session is
  ignored, so it can't silently steer unrelated work.
- **`/ctxjev:status`** shows what the last compaction's run actually did, including *why* if it
  skipped, failed, or fell back to offline scoring (a missing API key, a failed Jev request,
  nothing to score), plus the goal it used and every preserved entry with its score, highest
  first. The fastest way to check the plugin is working.

Five entries are preserved per compaction by default; set `CTXJEV_PRESERVE_LIMIT` (1–50) in the
environment Claude Code runs in to change that.

## Install

**From the Claude Code desktop app or CLI:**

```
/plugin marketplace add x96x64/ctxjev
```

Then install `ctxjev` from the marketplace list. Verified: adding the marketplace and installing
the plugin both work from the desktop app, and `/ctxjev:set-goal`/`/ctxjev:status` show up as
available skills immediately after.

**To develop against the plugin's own source** (this repo, not the installed copy):

```bash
git clone https://github.com/x96x64/ctxjev.git
cd ctxjev && pnpm install && pnpm build
claude --plugin-dir packages/claude-plugin
```

## Requirements

A [Jev](https://typesafe.ai) API key, exported as `TYPESAFE_API_KEY` in the environment Claude
Code itself runs in. Get one at
[console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys) (no waitlist).
Without it, the plugin falls back to scoring offline by keyword overlap: nothing is sent anywhere,
and the reminder says it was scored offline. It's much cruder than Jev, and `/ctxjev:status` tells
you why it fell back. The same fallback kicks in if a Jev request fails or takes more than 40
seconds. A bug here can never block your actual compaction. That's by design, not a side effect.

The Claude Code desktop app doesn't inherit variables exported in your shell profile. If
`/ctxjev:status` reports the key missing even though your terminal has it, set it where the app
can see it, for example with `launchctl setenv TYPESAFE_API_KEY ...` on macOS, then restart the
app.

## Privacy

Read this before installing. On every compaction, this plugin sends excerpts of your real session
(your messages, Claude's replies, and tool calls with their output) to TypeSafe AI's Jev API for
scoring. That's the whole mechanism, not a side channel, but it does mean conversation content
leaves your machine.

- **Secrets are masked first, on a best-effort basis.** Common key formats (Anthropic/OpenAI
  `sk-…`, GitHub tokens, AWS access keys, Slack tokens, JWTs, bearer tokens, private-key blocks)
  and the value of anything assigned to a name like `API_KEY`, `SECRET`, `TOKEN`, or `PASSWORD`
  are replaced with `[REDACTED]` before sending. That narrows exposure; it can't recognize every
  possible secret.
- **Only short excerpts are sent**, not whole files or full tool output.
- **The local cache stays out of git.** Scores and excerpts are written to `.ctxjev/` in your
  project, one file per session (so two sessions open on the same project never see each
  other's), which the plugin creates with its own `.gitignore` (`*`) so it can't be committed by
  accident.
- **Nothing is sent without a key.** With `TYPESAFE_API_KEY` unset, nothing leaves your machine.

---

Full design notes (why hooks can't do this the "obvious" way, why recency is scored relative to
the batch and not wall-clock time, how the scoring threshold was tuned against labeled data) live
in the main repo: **[github.com/x96x64/ctxjev](https://github.com/x96x64/ctxjev)**.

## License

This package is released under the [MIT](../../LICENSE) license: free to use, modify, and
distribute, including in a commercial product, as long as the license text and copyright notice
ship with it. See the [main repo](https://github.com/x96x64/ctxjev#license) for how this matches
every dependency `ctxjev` currently uses.
