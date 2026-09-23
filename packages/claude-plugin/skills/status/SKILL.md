---
description: Check what ctxjev is currently doing without waiting for a real compaction to trigger it — shows what the last PreCompact run did (and why, if it skipped or failed), the active scoring goal, and every preserved entry with its relevance score, highest first. The fastest way to confirm the plugin is actually working.
---

The user is invoking `/ctxjev:status`. Report, concisely, reading files in the project root:

1. **Last run**: read `.ctxjev/last-run.json`. Report its `at` time, `outcome`, and `scorer`
   (`jev`, or `local` for the offline keyword-overlap fallback). If the outcome is `skipped` or
   `error`, show the `reason` verbatim; if there's a `note` (why it fell back to offline scoring,
   for example a missing `TYPESAFE_API_KEY`), show that verbatim too. This is the only place these
   otherwise-silent problems become visible, so don't soften them. If the file doesn't exist, say
   no compaction has happened in this project since the plugin was installed.
2. **Goal**: from `last-run.json`, the `goal` and whether it was `explicit` (set with
   `/ctxjev:set-goal`) or `inferred` (the most recent chat message). If `ignoredStaleGoal` is
   present, say that an explicit goal from an earlier session was ignored and show it. Then, if
   `.ctxjev/goal.txt` exists, show its contents as the goal that the *next* compaction will use —
   but only if it's set during that session.
3. **Preserved entries**: read `.ctxjev/preserved/<sessionId>.json`, using the `sessionId` from
   `last-run.json` (or `.ctxjev/preserved/default.json` if it has none), and show each entry's
   `entryId`, `combinedScore`, and a short excerpt of its content, sorted by score descending. If
   the file doesn't exist, say nothing was preserved by that run.

Don't editorialize beyond that — this is a diagnostic read, not an invitation to re-score
anything yourself.
