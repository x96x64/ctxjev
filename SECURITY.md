# Security Policy

## Reporting a vulnerability

Please report it privately, through GitHub's
[private vulnerability reporting](https://github.com/x96x64/ctxjev/security/advisories/new)
("Report a vulnerability" on the repository's Security tab), not in a public issue or pull request.
Include what you found, how to reproduce it (with synthetic data, never a real transcript or a real
key), and what an attacker or a leak could get from it.

This is a small, single-maintainer project: expect an acknowledgment within a week. A fix ships in
the next release, or sooner as its own release if the problem is being exploited or leaks data;
the advisory is published once a fixed version is out.

## Supported versions

Only the latest release on npm (and, for the Claude Code plugin, the current `main`, which is what
the marketplace installs) gets security fixes.

## What's in scope

ctxjev handles agent transcripts, which routinely contain secrets pasted into chat or echoed by a
tool. The things most worth reporting:

- **Content leaving the machine unmasked.** With `scorer: 'jev'` (and in the Claude Code plugin
  whenever `TYPESAFE_API_KEY` is set), entry excerpts and the goal are sent to TypeSafe AI's Jev
  API after `redactSecrets()` masks recognizable secret formats. A common credential format that
  passes through it, or a code path that sends content without going through `buildJevRequest()`,
  is a vulnerability.
- **Data written to disk.** The plugin keeps state in `~/.claude/ctxjev/` (0700 directories, 0600
  files, secrets masked); the CLI's score cache is `~/.cache/ctxjev/score-cache.json` (0600,
  hashed keys, no transcript text). Anything written elsewhere, readable by others, or unmasked is
  in scope — as is anything deleted that ctxjev didn't create.
- **The published packages and the plugin bundle**: `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp`, and
  `packages/claude-plugin/dist/`, including their dependencies.

## Known limitations (not vulnerabilities by themselves)

- Secret masking is best-effort pattern matching. It catches common formats, not every possible
  secret; the README says so wherever content is sent.
- The eval harness (`packages/core/eval/`, maintainer-only, never run by the published packages)
  executes shell commands a model chose, in a temporary copy of a task repo but without a sandbox.
  Run it only on a machine where that's acceptable. Isolating it is planned.
