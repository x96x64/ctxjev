# Contributing to ctxjev

Issues and pull requests are welcome. This file covers setting up, the rules every change follows,
and how releases are made. [`CLAUDE.md`](CLAUDE.md) has the same rules in more detail (it's written
for AI coding agents working in this repo, but it's accurate for people too).

## Setup

- Node 20 or later for the packages; **Node 22** for the eval scripts ([`.nvmrc`](.nvmrc)).
- pnpm 9 (`corepack enable` picks up the version pinned in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm build        # every package; the Claude Code plugin's bundle lands in packages/claude-plugin/dist/
pnpm lint
pnpm typecheck    # the tests too, which the build leaves out
pnpm test         # no API key or network needed
```

Tests whose names end in `.live.test.ts` call the real Jev API and are skipped unless
`TYPESAFE_API_KEY` is set. Every other test must pass offline: tests that start a subprocess give it
an allowlisted environment ([`test-support/subprocessEnv.ts`](test-support/subprocessEnv.ts)) with
`TYPESAFE_BASE_URL` pointed at a closed local port, so nothing can reach the real API by accident.

The eval harness has checks that call no model and run in CI:

```bash
node examples/eval-tasks/verify.mjs                       # templates fail the hidden tests, solutions pass
cd packages/core && node eval/tasks.mjs --selftest        # the agent's workspace tools behave
cd packages/core && node eval/check-docs.mjs              # the docs' eval numbers match eval/results/
```

## Rules for every change

- **Never develop or test against a real Claude Code session log** (`~/.claude/projects/…`): they can
  hold secrets, and some code paths send content to Jev. Use the synthetic transcripts in
  [`examples/sample-transcripts`](examples/sample-transcripts).
- **Anything that sends content to Jev goes through `buildJevRequest()`** in
  `packages/core/src/jevClient.ts`, so it's masked by `redactSecrets()`. Anything written to disk is
  masked too.
- **Logic belongs in `ctxjev-core`**; the CLI, MCP server, and plugin are thin adapters.
- **Commit the rebuilt `packages/claude-plugin/dist/`** with any change under `packages/core/src` or
  `packages/claude-plugin/src`. Claude Code installs the plugin by cloning, with no build step; CI
  fails if the committed bundle is stale.
- **Never type an eval number into a doc.** Save the run to `packages/core/eval/results/`, then
  generate the numbers with `node eval/check-docs.mjs --write`. CI fails if they disagree.
- **Never weaken, skip, or delete a test to make it pass**, and never soften a negative result.
- **Dev vs. holdout:** the `dev` eval tasks informed the design, so their numbers are optimistic.
  The current `holdout` tasks have been run and analyzed, so they can't confirm a new claim either;
  a new claim needs new, preregistered material (see
  [`PREREGISTRATION.md`](packages/core/eval/PREREGISTRATION.md) for how the last one was done).
  Changing how a registered measure is computed means adding a new, labeled exploratory measure and
  recording it under "Changes after registration", not editing the plan.
- The paid evals (`eval/tasks.mjs`, `eval/outcome.mjs`, `eval/plugin.mjs`) cost real money and are
  run by hand, never in CI. Their `--report` and `--selftest` modes are free.
- Record user-visible changes in [`CHANGELOG.md`](CHANGELOG.md): one line per change, what changed and
  why it matters to users. Investigation details belong in the commit message.

## Release policy

Releases are made by the maintainer, from `main`, only through the
[`publish.yml`](.github/workflows/publish.yml) workflow (never `npm publish` from a laptop).

- **Batch changes into a release.** Don't publish after every fix. A docs-only change waits for the
  next release, unless npm is showing something wrong or misleading.
- **Versions are lockstep** across the four packages and the three plugin manifests. Bump all seven
  together, then run `node scripts/check-versions.mjs --update-pins` so every `ctxjev-mcp@<version>`
  in the MCP setup examples names the new version, and the marketplace serves the plugin from the
  new tag (below). The publish workflow refuses to run if any of them disagree.
- **0.x semantics:** a changed default or removed option is a minor bump (0.5 → 0.6) and is called
  out as breaking in the CHANGELOG; fixes and additions are patch bumps.
- **The CHANGELOG section for the version must exist** before publishing; it becomes the GitHub
  Release notes.
- **Before publishing**, with `TYPESAFE_API_KEY` set: `pnpm test` (runs the live tests) and, if
  anything about scoring changed, `cd packages/core && node eval/run.mjs --gate --runs 3`. The
  workflow runs both itself, plus the version/pin check, then publishes `ctxjev-core`, `ctxjev-cli`,
  and `ctxjev-mcp` (in that order), tags `v<version>`, and creates the GitHub Release.
- **The npm CLI and the GitHub Actions used are pinned** (npm by exact version in `publish.yml`,
  actions by commit SHA). Bump them on purpose; Dependabot proposes the action and dependency
  updates weekly.
- **The Claude Code plugin** isn't on npm; the marketplace installs it from this repository. From
  the 0.6.0 release commit on, its entry in `.claude-plugin/marketplace.json` is a `git-subdir`
  source at `ref: "v<version>"`, the tag the publish workflow creates, so plugin users get released
  code only (before, it pointed at `packages/claude-plugin` on `main`, released or not).
  `--update-pins` moves the ref, and the workflow's version check refuses a release whose entry
  doesn't name its own tag. Between merging the release commit and the workflow creating the tag,
  a new install fails for those few minutes; existing installs are unaffected. Claude Code updates
  an installed plugin when its `version` changes, so the version bump is what reaches users.

## Reporting a vulnerability

Please don't open a public issue; see [`SECURITY.md`](SECURITY.md).
