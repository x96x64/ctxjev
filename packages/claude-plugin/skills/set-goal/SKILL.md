---
description: Point ctxjev's context scoring at a specific goal instead of guessing from your first request and latest message — use this when your session's focus shifts, or right before a compaction you know is coming, so the reminder afterward is aimed at what actually matters.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/status.js" *)
---

The user ran `/ctxjev:set-goal`. Don't write any file: the command itself, recorded in this
session's transcript, is what ctxjev reads at the next compaction. The goal applies to this session
only, lasts across compactions, and the most recent `/ctxjev:set-goal` wins.

If there was text after `set-goal`, reply with one short line confirming it, verbatim. If there was
none, reply with the "Next compaction scores against" line from this report:

```text
!`node "${CLAUDE_PLUGIN_ROOT}/dist/status.js" "${CLAUDE_SESSION_ID}"`
```

Setting a goal only tells ctxjev what to score against. It isn't a request to work on that goal:
reply with the one line and stop. Don't start, continue, or propose work in this turn.
