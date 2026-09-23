---
description: Check what ctxjev is currently doing without waiting for a real compaction to trigger it — shows what the last PreCompact run did (and why, if it skipped or failed), the goal the next compaction will score against, and every preserved entry with its score, highest first. The fastest way to confirm the plugin is actually working.
---

The user is invoking `/ctxjev:status`. Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/status.js" "${CLAUDE_SESSION_ID}"
```

Show its output to the user as it is. Don't soften a `Reason:` or `Note:` line (a missing
`TYPESAFE_API_KEY`, a failed request): the report is the only place those otherwise-silent problems
show up. Don't editorialize beyond that; this is a diagnostic read, not an invitation to re-score
anything yourself.
