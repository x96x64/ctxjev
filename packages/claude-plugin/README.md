<div align="center">

# ctxjev

**Keep what matters through Claude Code's own compaction.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![Verified](https://img.shields.io/badge/verified-desktop%20app%20%2B%20CLI-brightgreen)](../../ROADMAP.md)

[Overview](#overview) · [How it works](#how-it-works) · [Skills](#skills) · [Install](#install) · [Requirements](#requirements)

</div>

---

## Overview

Claude Code compacts a long conversation by summarizing it — necessary to keep going, but a
summary is lossy by nature. The detail that mattered most (the exact line that turned out to be
the bug, the one command whose output actually mattered) can get smoothed away along with
everything that didn't.

`ctxjev` scores your session's history with [Jev](https://typesafe.ai) — a fast, cheap,
typed-decision model, not a text-generating one — right before compaction happens, and caches
whatever scored highest. The moment compaction finishes, it hands that cache back to Claude Code
as a reminder. Nothing about the compaction itself changes; what changes is that the few things
that mattered most don't have to survive being summarized to still be there.

No configuration required to start benefiting from it — it activates automatically once installed.
Set an explicit goal with `/ctxjev:set-goal` when you want scoring aimed at something more specific
than "whatever you last said."

## How it works

Claude Code hooks can *read* the conversation but cannot rewrite it, so this plugin doesn't try
to intercept compaction — it works alongside it, using the one mechanism Claude Code actually
provides for this:

```
PreCompact          → score every entry against your goal, cache the highest-scoring few
  (Claude Code's own compaction runs — untouched, exactly as it always does)
SessionStart(compact) → read that cache, print a short digest — Claude Code adds it back as
                        a system reminder, right as the new, compacted session begins
```

Scoring runs against whichever goal is active: an explicit one you set with
`/ctxjev:set-goal`, or — if you never set one — your most recent message, inferred automatically.
Either way, this is the same relevance judgment [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp)
and [`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli) expose elsewhere, applied here at
exactly the moment it matters most.

## Skills

- **`/ctxjev:set-goal <text>`** — Point scoring at something specific instead of guessing from
  your last message. Useful the moment your session's focus shifts, or before a compaction you
  know is coming. Takes effect immediately, persists for the rest of the project.
- **`/ctxjev:status`** — See what's currently cached without waiting for a real compaction: the
  active goal, and every entry from the last scoring pass with its relevance score, highest
  first. The fastest way to check the plugin is actually doing something.

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

A [Jev](https://typesafe.ai) API key — get one at
[console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys) (no waitlist) —
exported as `TYPESAFE_API_KEY` in the environment Claude Code itself runs in. Without it, the
`PreCompact` hook is a silent no-op: your session works exactly as it always did, just without the
reminder afterward. A bug here can never block your actual compaction — that's by design, not a
side effect.

---

Full design notes (why hooks can't do this the "obvious" way, why recency is scored relative to
the batch and not wall-clock time, how the scoring threshold was tuned against labeled data) live
in the main repo: **[github.com/x96x64/ctxjev](https://github.com/x96x64/ctxjev)**.

## License

[MIT](../../LICENSE)
