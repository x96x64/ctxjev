# Roadmap

What's next, and the constraints that shaped the design. What has shipped is in
[CHANGELOG.md](CHANGELOG.md).

## Where things stand

<!-- checked-prose -->
- The preregistered held-out comparison has run: Jev's ranking tied plain truncation on task
  success (<!-- generated:holdout-diff-short -->0 points, 95% CI [0, 0] with Claude Haiku 4.5 and with Claude Sonnet 5, 6 unseen tasks<!-- /generated:holdout-diff-short -->), so `recency` (plain
  truncation) is the library's and the CLI's default and Jev is opt-in. Details are in
  [docs/evaluation.md](docs/evaluation.md).
<!-- /checked-prose -->

## Next

1. **A new held-out set, checked independently.** The current one is used up, and it has known
   defects (listed in [docs/evaluation.md](docs/evaluation.md)). The plan, in Japanese, is the
   [scoring and evaluation redesign](docs/design/round-2-scoring-and-evaluation.md): a hybrid of
   cheap deterministic signals built on the dev split only, with Jev as an optional feature compared
   with and without it; new tasks, some written by a separate agent from a written spec;
   preregistered and committed before any scoring, then run once within a fixed budget.
2. **Why Jev ranked below keyword overlap and a random order on the held-out retention measure**
   when it beat both on dev. The leading explanation is a labeling difference between the two
   splits (the held-out sessions labeled nothing after the fix request).
3. **Codex compaction hooks.** Codex now has `PreCompact` and `SessionStart` (`source: "compact"`)
   hooks, so the Claude Code plugin's approach could work there too, but it needs a parser for
   Codex's own session logs and a check against a real Codex compaction.
4. Token budgets with Claude's own token counting instead of `gpt-tokenizer`, if scorer choice
   starts to hinge on budgets tighter than the ones measured so far.

## Constraints that shaped the design

- **Claude Code hooks can't rewrite the transcript.** The first plugin design, a hook that prunes
  ahead of Claude Code's own compaction, isn't buildable: a hook can read `transcript_path` but not
  change it. The plugin uses the documented pattern instead: score at `PreCompact`, re-inject a
  digest at `SessionStart` (`matcher: "compact"`).
- **An MCP tool can't shrink its host's context**, and sending history as tool arguments costs the
  host output tokens. So `ctxjev-mcp` is for frameworks that act on the scores, not a token saver.
- **Jev only answers typed questions**: no counting, no text. Token counts are computed, and
  `summarize` either keeps an excerpt or calls your own summarizer.

More on each choice: [docs/design-notes.md](docs/design-notes.md).
