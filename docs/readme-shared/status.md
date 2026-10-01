## Status and limits

<!-- checked-prose -->
Whether pruning this way helps an agent finish its work hasn't been shown. In a preregistered
comparison on <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> tasks the design had never seen, Jev's ranking and plain truncation
gave the same task success (difference in percentage points, with its 95% CI:
<!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku --> with Claude Haiku 4.5, <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet --> with Claude Sonnet 5). On the
preregistered measure of what each task needed, Jev's ranking kept <!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev --> under a tight budget, less
than a random ordering of the same entries (<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->), and the Claude Code plugin's digest had no
demonstrated effect. The [evaluation](../../docs/evaluation.md) has
every number and what it can't show.
<!-- /checked-prose -->
