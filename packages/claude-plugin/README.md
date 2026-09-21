# ctxjev-claude

Claude Code plugin built on `ctxjev-core`.

## Planned pieces

- **Hook**: runs ahead of Claude Code's own context compaction, scoring old tool-call
  entries via Jev and dropping/summarizing the clearly-irrelevant ones first — so the
  built-in summarizer has less to compress, and less useful history gets swept up into a
  lossy summary. Exact hook name/lifecycle to confirm against Claude Code's current hooks
  API before implementing (phase 3) — don't assume a specific hook exists yet.
- **Skill**: an on-demand `/ctxjev` command to inspect current context composition (what
  Jev would keep/drop/summarize right now) and manually trigger a prune mid-session.

## Status

Not implemented — placeholder for phase 3 (see [ROADMAP.md](../../ROADMAP.md)). Needs
`packages/core` finished first.
