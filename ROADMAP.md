# Roadmap

What's done, in one line each, and what's next. The detail behind each phase is in the git history
and [CHANGELOG.md](CHANGELOG.md).

## Next

1. **Round 2** ([plan, in Japanese](docs/design/round-2-scoring-and-evaluation.md)): a hybrid of
   cheap deterministic signals, built on the dev split only, with Jev as an optional feature
   compared with and without it; 24 new tasks, 8 of them written by a separate agent from a written
   spec; preregistered and committed before any scoring, then run once within a fixed budget.
2. **Why Jev ranked below keyword overlap and a random order on the holdout's retention measure**
   when it beat both on dev. The labeling difference between the two splits (the holdout labeled
   nothing after the fix request) is the leading explanation; the Round 2 retention measure (v2)
   stops at the fix request for that reason.
3. Token budgets with Claude's own token counting instead of `gpt-tokenizer`, if scorer choice
   starts to hinge on budgets tighter than 25%.

## Constraints that shaped the design

- **Claude Code hooks can't rewrite the transcript.** The first plugin design, a hook that prunes
  ahead of Claude Code's own compaction, isn't buildable: a hook can read `transcript_path` but not
  change it. The plugin uses the documented pattern instead: score at `PreCompact`, re-inject a
  digest at `SessionStart` (`matcher: "compact"`).
- **An MCP tool can't shrink its host's context**, and sending history as tool arguments costs the
  host output tokens. So `ctxjev-mcp` is for frameworks that act on the scores, not a token saver.
- **Jev only answers typed questions**: no counting, no text. Token counts are computed, and
  `summarize` either keeps an excerpt or calls your own summarizer.

## Done

- Phase 0–1: workspace scaffold; `core` with chunked `noul` fan-out, recency blending, and a
  keep/drop/summarize policy.
- Phase 2: MCP server with `score_relevance` and `prune_history`, verified in-process.
- Phase 3: Claude Code plugin on PreCompact / SessionStart(compact), after the rewrite design was
  ruled out.
- Phase 4: Codex verified hands-on, Copilot config from its docs; Xcode ruled out.
- Phase 5: the Claude Code transcript parser moved to `core` so the CLI reads real sessions;
  sidechains excluded.
- Phase 6–7: first npm release; trusted publishing verified.
- Phase 8–9: desktop-app plugin install; an Agent Plugins bundle for Codex.
- Phase 10–11: self-audit fixes (`/compact` taken as the goal, among others); the README
  rewritten to say what each integration can actually do, and the privacy disclosure.
- Phase 12–13: `pruneMessages()` for Anthropic Messages; Japanese text; real token counts.
- Phase 14–17 (0.4.0): pluggable scorer; `pruneMessages()` budgets, `summarize`, and prompt-cache
  reporting; realistic eval sessions; `dropBelow` 0.3.
- Phase 18–22: model-graded outcome eval; recorded sessions on throwaway task repos; task-
  completion eval.
- Phase 23–27 (0.5.0): `keepUserText` and the removal note; ten tasks with bootstrap intervals; the
  plugin measured; Sonnet 5 on the task eval (the strategies stop differing).
- 0.6.0: the review round.
  - Goal inference fixed on real transcripts.
  - `/ctxjev:set-goal` made per-session.
  - Plugin state moved out of the project.
  - The eval split into dev and holdout, and the holdout comparison preregistered — then run:
    Jev tied plain truncation on task success (+0 points, 95% CI [+0, +0], two models, six unseen
    tasks). **`recency` (plain truncation) is now the default scorer**; Jev is opt-in
    (`scorer: 'jev'`). `ctxjev-mcp` is unaffected, since exposing Jev is its whole purpose.
  - The release gate made strict.
  - The plugin's holdout comparison, run twice: no demonstrated effect in either run. The plugin
    now scores offline by default; Jev is opt-in (`CTXJEV_SCORER=jev`).
