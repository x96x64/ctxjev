---
description: Check what ctxjev is currently doing without waiting for a real compaction to trigger it — shows the active scoring goal and every entry from the last PreCompact pass with its relevance score, highest first. The fastest way to confirm the plugin is actually working.
---

The user is invoking `/ctxjev:status`. Report, concisely:

1. The current goal: read `.ctxjev/goal.txt` in the project root. If it doesn't exist, say the
   goal will fall back to "most recent user message" at the next compaction.
2. The last preserved-context snapshot: read `.ctxjev/preserved-context.json` in the project root
   (if it exists) and show each entry's `entryId`, `combinedScore`, and a short excerpt of its
   content, sorted by score descending. If it doesn't exist, say no `PreCompact` has run yet in
   this project.

Don't editorialize beyond that — this is a diagnostic read, not an invitation to re-score
anything yourself.
