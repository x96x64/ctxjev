---
description: Set the goal ctxjev scores context relevance against, instead of guessing it from your last message.
---

The user is invoking `/ctxjev:set-goal <text>`. Take everything after `set-goal` as the goal text
verbatim (it may itself contain spaces or quotes — don't reinterpret or summarize it).

Write it to `.ctxjev/goal.txt` in the current project root (create the `.ctxjev` directory if it
doesn't exist), overwriting any previous contents. Then confirm back to the user what was saved,
in one short line.

If the user ran `/ctxjev:set-goal` with no text, don't write anything — tell them the current
contents of `.ctxjev/goal.txt` if it exists, or that no goal is set (in which case ctxjev's
PreCompact hook falls back to the most recent user message as a proxy goal).
