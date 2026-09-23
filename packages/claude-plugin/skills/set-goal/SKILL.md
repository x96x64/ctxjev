---
description: Point ctxjev's context scoring at a specific goal instead of guessing from your first request and latest message — use this when your session's focus shifts, or right before a compaction you know is coming, so the reminder afterward is aimed at what actually matters.
---

The user is invoking `/ctxjev:set-goal <text>`. Take everything after `set-goal` as the goal text
verbatim (it may itself contain spaces or quotes — don't reinterpret or summarize it).

Write it to `.ctxjev/goal.txt` in the current project root, overwriting any previous contents. If
the `.ctxjev` directory doesn't exist yet, create it, and also create `.ctxjev/.gitignore`
containing a single line `*` — this directory holds transcript excerpts and must never be
committed. Then confirm back to the user what was saved, in one short line.

The goal applies to the current session only: a goal set in an earlier session is ignored at the
next compaction (ctxjev falls back to your first request plus your latest message instead), so a stale goal can't
silently steer unrelated work. Mention this in your confirmation only if the user seems to expect
it to carry over.

If the user ran `/ctxjev:set-goal` with no text, don't write anything — tell them the current
contents of `.ctxjev/goal.txt` if it exists, or that no goal is set (in which case ctxjev's
PreCompact hook falls back to your first request plus your latest message as a proxy goal).
