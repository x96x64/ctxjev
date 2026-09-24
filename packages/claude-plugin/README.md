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

No configuration is required: it activates automatically once installed. Set an explicit goal
with `/ctxjev:set-goal` when you want scoring aimed at something more specific than your first
request plus your latest instruction.

**What it's shown so far:** in the [plugin eval](../../README.md#does-it-work), against a simulated
compaction summary that already keeps every user instruction, the digest added +5 points [0, +15]
on the tasks the plugin was designed against: within the noise. The preregistered comparison on
unseen tasks found no demonstrated effect (summary+digest 89% tasks passed vs. summary alone's
100%, 95% CI for the difference [-22, +0] — see
[`PREREGISTRATION.md`](../../packages/core/eval/PREREGISTRATION.md#plugin-rerun)). How much it
helps depends on how much Claude Code's real compaction drops, which neither eval can measure. The
plugin remains available and on by default; nothing here claims it improves outcomes.

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
skill's expanded instructions) is never taken for your request. Either way, this is
the same relevance judgment [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp) and
[`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli) expose elsewhere, applied here at exactly
the moment it matters most.

## Skills

- **`/ctxjev:set-goal <text>`** points scoring at something specific. Useful the moment your
  session's focus shifts, or before a compaction you know is coming. Nothing is written anywhere:
  the command is recorded in the session's transcript, and that's what the next compaction reads.
  So it applies to that session only (another session open on the same project keeps its own),
  lasts through compactions, and the latest one wins.
- **`/ctxjev:status`** shows the goal the next compaction will use, what the last compaction's run
  actually did, including *why* if it skipped, failed, or fell back to offline scoring (a missing
  API key, a failed Jev request, nothing to score), and every preserved entry with its score,
  highest first. The fastest way to check the plugin is working. It's answered by a hook before
  your prompt reaches Claude, so checking never starts a model turn (or any work).

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
you why it fell back. The same fallback kicks in if a Jev request fails or takes more than 20
seconds, so compaction is never held up for long. A bug here can never block your actual
compaction. That's by design, not a side effect.

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
- **Nothing is written into your project.** Scores and excerpts go to
  `~/.claude/ctxjev/sessions/<session id>/` (under `CLAUDE_CONFIG_DIR` if you set it), readable only
  by you, one directory per session, and only the 50 most recent sessions are kept. Versions
  before 0.6.0 kept this in `.ctxjev/` inside your project; the next compaction removes the files
  they wrote there, and the directory too if nothing else is in it.
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
