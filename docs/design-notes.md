# Design notes

Why ctxjev works the way it does. For what it does, see the [README](../README.md); for what it has
and hasn't been shown to achieve, see [evaluation.md](evaluation.md).

## Constraints

- **Claude Code hooks can't rewrite the transcript.** A hook can read `transcript_path`, and on a
  few events print text that Claude Code adds to context, but it can't remove old entries. So the
  plugin doesn't prune: it scores at `PreCompact`, caches the top few entries, and prints them as a
  digest at `SessionStart` with `matcher: "compact"`, the documented way to put content back after
  compaction.
- **An MCP tool can't shrink its host's context**, and the agent pays output tokens to send its
  history as tool arguments. So `ctxjev-mcp` is for frameworks that act on the scores, not a token
  saver.
- **Jev only answers typed questions:** a yes/no probability, a choice, or a score. It can't count,
  see images, or write text. Token counts are computed, and `summarize` either keeps an excerpt or
  calls your own summarizer.

## Choices

- **Claude Code's transcript format stays in one module.**
  [`claudeCodeTranscript.ts`](../packages/core/src/claudeCodeTranscript.ts) parses Claude Code's
  undocumented session log, so a format change is a one-file fix. It returns only what's still in
  context (a compaction boundary resets the list), skips subagent sidechains (their result already
  appears as a tool call), and skips text Claude Code writes into the user turn itself: meta
  records, local command output, interrupt notices.
- **Every chunk sees the latest activity.** Entries are scored in chunks of 50, and each chunk's
  shared state also carries the batch's most recent entries, so an old failing test is judged
  knowing a later run fixed it. The score cache is keyed on that context too.
- **Jev bills input tokens**, and those grow with the entries in a request, since each entry's
  excerpt is part of the shared state. Every request's actual usage is reported through `onUsage`,
  and the CLI prints the cost of each run.
- **Secrets are masked before anything leaves the machine.** Every Jev request is built in
  [`buildJevRequest()`](../packages/core/src/jevClient.ts), which runs the goal and content through
  [`redactSecrets()`](../packages/core/src/redact.ts) first. Best-effort, not a guarantee; how well
  it works is measured in [evaluation.md](evaluation.md#secret-masking-measured-blind).
- **No key means no request.** `typesafeApiKey()` decides whether the environment holds a usable
  key, and a value that is only an unexpanded placeholder (`${TYPESAFE_API_KEY}`) isn't one: Codex
  passes a plugin's `${…}` references through as they are.
- **The scorer is pluggable, and the baselines ship.** `scorer` takes `'jev'`, `'recency'` (plain
  truncation), `'local'` (keyword overlap), or your own function, called per chunk with content
  already masked. The evaluation compares against the first two on every run.
- **Savings count what's actually removed, at its real size**: each entry's `sourceTokens`, the
  full payload, not the 600-character excerpt that gets scored. What `summarize` saves is reported
  separately, since it depends on your summarizer.
- **Pruning a conversation keeps it a valid request.**
  [`pruneMessages()`](../packages/core/src/anthropicMessages.ts) removes a `tool_use` and its
  `tool_result` together, never touches the first message or the latest turn (from the last user
  message with text of its own onward: `protectLastTurn`), and reports how much of a prompt cache
  the change invalidates. See [prompt caching](../packages/core/README.md#with-prompt-caching).
- **Recency is relative to the batch**, oldest 0 to newest 1, not to `Date.now()`, so a transcript
  analyzed after the fact scores the same as a live one. `combinedScore` blends it in linearly at
  `recencyWeight` (default 0.1, from [a sweep](../packages/core/eval/run.mjs) over labeled fixtures,
  one built so the root cause is early). `dropBelow` is 0.3, the highest value that lost no
  relevant entry on either fixture set.
- **Under `local`, overlap is ranked within the batch** before the thresholds apply, so they read
  as shares of the batch rather than as probabilities: raw overlap rarely reaches 0.3, and the
  thresholds used to drop almost everything.
- **Jev is never asked to count.** Token counts come from
  [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer), an approximation of Claude's
  tokenizer, and costs from the usage Jev's API reports for each request.
