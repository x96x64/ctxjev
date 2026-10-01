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

Only the latest release gets security fixes: on npm, the version tagged `latest`; for the Claude
Code plugin, the release the marketplace entry (`.claude-plugin/marketplace.json`) names by its tag.
The marketplace installs that release, not `main`. Every release is published from a commit on
`main` that CI passed, and tagged with its version only after the publish workflow's checks pass
(see CONTRIBUTING.md).

## What's in scope

ctxjev handles agent transcripts, which routinely contain secrets pasted into chat or echoed by a
tool. The things most worth reporting:

- **Content leaving the machine unmasked.** Nothing is sent anywhere by default: the CLI and the
  library score offline unless asked for Jev (`--scorer jev`, `scorer: 'jev'`), and the Claude Code
  plugin only when `CTXJEV_SCORER=jev` is set, a key alone is not enough. The MCP server's two tools
  always use Jev, so it needs a key to do anything. When Jev is used, entry excerpts and the goal
  are sent to TypeSafe AI's Jev API after `redactSecrets()` masks recognizable secret formats. A
  common credential format that passes through it, content sent while Jev wasn't asked for, or a
  code path that sends content without going through `buildJevRequest()`, is a vulnerability.
- **Data written to disk.** The plugin keeps state in `~/.claude/ctxjev/` (0700 directories, 0600
  files, secrets masked); the CLI's score cache is `~/.cache/ctxjev/score-cache.json` (0600,
  hashed keys, no transcript text). Anything written elsewhere, readable by others, or unmasked is
  in scope — as is anything deleted that ctxjev didn't create.
- **The published packages and the plugin bundle**: `ctxjev-core`, `ctxjev-cli`, `ctxjev-mcp`, and
  `packages/claude-plugin/dist/`, including their dependencies.

## Known limitations (not vulnerabilities by themselves)

- Secret masking is best-effort pattern matching. It catches common formats, not every possible
  secret; the README says so wherever content is sent. A value that reads as a variable reference
  (`$NAME`, `%NAME%`) is deliberately left as it is, even when a real password happens to have that
  shape (see `redactSecrets` in [packages/core/README.md](packages/core/README.md)).
- The eval harness (`packages/core/eval/`, maintainer-only, never run by the published packages)
  executes shell commands a model chose. They run in a sandbox (`packages/core/eval/sandbox.mjs`:
  docker, bubblewrap, `unshare`, or macOS `sandbox-exec`, whichever is available) that can see only
  a temporary copy of the task repo and can't reach the network; a run refuses to start if the
  sandbox fails its own checks. It runs unconfined only when someone sets `CTXJEV_SANDBOX=none`.
  A way out of the sandbox is in scope.
