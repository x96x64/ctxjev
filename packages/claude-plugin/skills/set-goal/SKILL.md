---
description: Point ctxjev's context scoring at a specific goal instead of guessing from your first request and latest message — use this when your session's focus shifts, or right before a compaction you know is coming, so the reminder afterward is aimed at what actually matters.
---

The user is invoking `/ctxjev:set-goal <text>`. Don't write any file: the command itself, recorded in
this session's transcript, is what ctxjev reads at the next compaction. The goal applies to this
session only, lasts across compactions, and the most recent `/ctxjev:set-goal` wins.

If there was text after `set-goal`, confirm it back to the user in one short line, verbatim.

If there was no text, run `node "${CLAUDE_PLUGIN_ROOT}/dist/status.js"` and show the user its
"Goal" line, which says what the next compaction will score against.
