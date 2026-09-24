# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

`ctxjev` — a context-pruning toolkit for long-running AI agents, built on TypeSafe AI's Jev
(a fast/cheap "System One" model that returns typed decisions, not text). See [README.md](README.md)
for the pitch and [ROADMAP.md](ROADMAP.md) for phased scope.

## Structure

pnpm workspace monorepo. `packages/core`, `packages/cli`, `packages/mcp-server`, and
`packages/claude-plugin` all have real, working logic verified against the live Jev API (see
[ROADMAP.md](ROADMAP.md) for what "verified" means for each — a couple of things are only proven
via a synthetic/subprocess test). `core` exports the pieces every other package is a thin adapter
over: `scoreEntries()`/`pruneContext()` (relevance+recency scoring, with or without the
keep/drop/summarize decision), and `parseClaudeCodeTranscript()`/`resolveClaudeCodeGoal()` (parsing
Claude Code's own session log format and finding the goal in it — used by both `ctxjev-cli` and
`ctxjev-claude`, which is why it lives in `core` rather than either of them). Don't add logic to an adapter package that belongs
in `core` instead.

**Claude Code hooks cannot rewrite the transcript** — this constrained `packages/claude-plugin`'s
whole design (see "Constraints that shaped the design" in [ROADMAP.md](ROADMAP.md)). A hook can
only read the transcript and, on specific events, print text to stdout that Claude Code adds back
to context. Don't design a feature here around a hook mutating past conversation content — it
can't.

The plugin keeps its state in `~/.claude/ctxjev/sessions/<session id>/` (`CTXJEV_STATE_DIR`
overrides it; tests and `eval/plugin.mjs` set it), never in the user's project. The hooks and
`dist/status.js` (run from the status skill's Bash call) must agree on that path, so it can't
depend on anything only the hook environment has. `/ctxjev:set-goal` writes nothing: the goal is
read back from the command's own record in the session transcript (`findExplicitGoal()`).
`/ctxjev:status` is answered by a UserPromptSubmit hook (`statusHook.js`) that blocks the prompt with
the report, so it never gets a model turn: as a skill, Claude Haiku used that turn to start editing
and committing after a compaction. Anything ctxjev puts in front of the model (the digest, a
report) quotes goals and excerpts as data; an imperative goal line reads as a request.

## Jev constraints (don't design around what it can't do)

- Text/structured input only — no images, audio, video.
- No arithmetic or counting — do that in code (e.g. tiktoken for token counts), never ask Jev to compute it.
- No free text generation — every call is a `noul` (yes/no probability), `choice` (pick from ≤255 options
  with a probability distribution), or `score` (position on a 2-10 scale) question against a shared state.
- Each request can fan out many independent questions against one shared state cheaply — batch entries
  into a chunk rather than one request per entry (see `packages/core/src/chunk.ts`).

## Commands

```bash
pnpm install && pnpm build   # build every package (tsc -b), from the repo root
pnpm test                    # run every package's tests, recursing via pnpm -r
pnpm lint                    # ESLint over the whole workspace (CI runs it on Node 20 and 22)
node packages/cli/dist/index.js analyze <transcript.json> --goal "..."
node packages/mcp-server/dist/index.js   # stdio MCP server — expects an MCP client, not a terminal

# Simulate what Claude Code's hooks actually send a plugin script over stdin:
echo '{"cwd":"...","transcript_path":"...","session_id":"s1"}' | node packages/claude-plugin/dist/preCompact.js
echo '{"cwd":"...","session_id":"s1"}' | node packages/claude-plugin/dist/sessionStartCompact.js

cd packages/core && pnpm eval   # score labeled fixtures: offline baseline always, Jev too with a key
                                # (publish.yml runs `node eval/run.mjs --gate --runs 3`, which fails
                                # without a key unless --allow-skip, and reads only the dev split)
cd packages/core && node eval/outcome.mjs --runs 2 --max-usd 6 --out eval/results/outcome.json
                                # model-graded outcome eval: needs ANTHROPIC_API_KEY (also in
                                # .env.local) and costs ~$4 a run; by hand, not in CI
cd packages/core && node eval/tasks.mjs --runs 2 --max-usd 4 --out eval/results/tasks.json
                                # task-completion eval on examples/eval-tasks (~$2.50 a run);
                                # `--selftest` checks the harness with no API calls;
                                # `--agent-model claude-sonnet-5` for a stronger agent,
                                # `--run-offset N --merge` to add runs to saved results, and
                                # `--split dev|holdout|all` (outcome/plugin/run.mjs take it too)
node examples/eval-tasks/verify.mjs  # every task: template fails the hidden tests, solution passes
cd packages/core && node eval/check-docs.mjs [--write]
                                # README/PREREGISTRATION.md eval numbers vs. eval/results/ (CI runs
                                # it); never type an eval number into a doc, --write generates it.
                                # The evals need Node 22 (.nvmrc); the packages, Node 20+
cd packages/core && node eval/plugin.mjs --runs 2 --max-usd 4.5 --out eval/results/plugin.json
                                # the Claude Code plugin's hooks after a simulated compaction
```

`TYPESAFE_API_KEY` (from `console.typesafe.ai/settings/keys`) must be set for anything that
actually calls Jev — `scoreRelevance()`/`pruneContext()`, the CLI's `analyze` command, the MCP
server's two tools, and `packages/claude-plugin`'s `PreCompact` hook. It's kept in `.env.local` at
the repo root (gitignored, never commit it) — `source .env.local` before running anything live.
Without a key, `scorer: 'local'` (`localRelevance.ts`, keyword overlap) scores offline; the plugin
falls back to it automatically and the CLI exposes it as `--offline`.
`--help`/`--version` and the pure-logic test files don't need it; every test file whose name ends
in `.live.test.ts` (in `core`, `mcp-server`, and `claude-plugin` — `cli` has none) is skipped
automatically when the key is absent rather than failing. CI only sets the key for the publish
workflow's test step.

**When developing or testing, never run any of this against real session transcripts**
(`~/.claude/projects/*/*.jsonl`) — they can contain secrets pasted into chat (this project's own
history does, from setting up `TYPESAFE_API_KEY` originally), and `preCompact.js`/`selectPreserved`
and `ctxjev-cli analyze` send entry content to the live Jev API. Use a synthetic fixture instead
(see `packages/core/src/claudeCodeTranscript.test.ts` for the shape, or
`examples/sample-transcripts/claude-code-session.jsonl` for a ready-made one). The *shipped*
plugin does score its users' real transcripts — that's its purpose — which is why every request
goes through `redactSecrets()` (`packages/core/src/redact.ts`) and the plugin README discloses it.
Any new path that sends content to Jev must go through `buildJevRequest()` in `jevClient.ts` so it
inherits that masking.

The one exception is `examples/eval-sessions/recorded-*.json`: real Claude Code sessions, but
recorded on purpose on the throwaway task repos in `examples/eval-tasks/` (`record.mjs`, run with a
clean environment so no personal hooks, MCP servers, or keys are involved), converted and scrubbed
by `packages/core/eval/import-claude-code.mjs`, and read in full before being committed. Only the
transcript `record.mjs` itself produced may be read that way — never anything else under
`~/.claude/projects`.

**Dev vs. holdout.** Every task's `task.json` has a `split`. The ten `dev` tasks and all current
eval sessions informed the design, so their numbers are optimistic. The `holdout` tasks are
reserved for the comparison in `packages/core/eval/PREREGISTRATION.md`: until it has run, don't
use anything about them (results, failures, recorded sessions beyond labeling) to change scoring,
pruning, the plugin, or the harness, and don't describe dev results as held out.

`parseClaudeCodeTranscript()` skips `isSidechain: true` records (a subagent's own private
conversation) — that content already shows up in the main thread as an ordinary
tool_use/tool_result pair, so including the sidechain too would double up on it and score content
that was never part of what the parent session's compaction actually operates on.

## Releasing

- Versions are lockstep across all four packages and the three plugin manifests (see
  CHANGELOG.md); `publish.yml` refuses to publish if they disagree.
- Batch changes into a release instead of publishing after every fix. A docs-only change waits for
  the next release unless npm is showing something wrong or misleading.
- Before publishing, run the live suite with `TYPESAFE_API_KEY` set (`pnpm test` picks up every
  `.live.test.ts`), and `cd packages/core && pnpm eval` if anything about scoring changed.
  `publish.yml` does both on its own — the live tests and `eval/run.mjs --gate` — using the
  `TYPESAFE_API_KEY` repository secret, then tags the release and creates its GitHub Release from
  this version's CHANGELOG section (so that section must exist before publishing).
- `packages/claude-plugin/dist/` is committed: run `pnpm build` and commit it with any change under
  `packages/claude-plugin/src` or `packages/core/src`. CI fails if it's stale.
- CHANGELOG entries are for users: one line per change, what changed and why it matters to them.
  Investigation detail belongs in the commit message.
