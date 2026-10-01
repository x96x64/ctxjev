# ctxjev

**en** | [ja](https://github.com/x96x64/ctxjev/blob/main/README.ja.md) | [zh](https://github.com/x96x64/ctxjev/blob/main/README.zh.md) | [es](https://github.com/x96x64/ctxjev/blob/main/README.es.md) | [ko](https://github.com/x96x64/ctxjev/blob/main/README.ko.md) | [pt](https://github.com/x96x64/ctxjev/blob/main/README.pt.md) | [fr](https://github.com/x96x64/ctxjev/blob/main/README.fr.md) | [de](https://github.com/x96x64/ctxjev/blob/main/README.de.md)

**Score an AI agent's history and decide what to keep, drop, or summarize: offline by default, or
with TypeSafe AI's [Jev](https://typesafe.ai) if you opt in.**

[![npm: ctxjev-core](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm: ctxjev-cli](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm: ctxjev-mcp](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-core.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-core.svg)](https://nodejs.org)

- **Nothing leaves your machine by default** with the CLI, the library, or the Claude Code plugin.
  Jev is opt-in (`--scorer jev`, `scorer: 'jev'`, `CTXJEV_SCORER=jev`) and needs `TYPESAFE_API_KEY`.
- **The MCP server is the exception:** its tools use Jev unless a call passes `scorer: "local"` or
  `"recency"`.
- **Its benefit is unproven:** on held-out tasks, no scorer has been shown to help an agent finish
  more tasks than plain truncation. See [Status and limits](#status-and-limits).

## Try it in 30 seconds

```bash
npm install -g ctxjev-cli
curl -O https://raw.githubusercontent.com/x96x64/ctxjev/main/examples/sample-transcripts/checkout-bug.json
ctxjev analyze checkout-bug.json
```

```console
$ ctxjev analyze checkout-bug.json
score: 0–1, position in the transcript (oldest 0, newest 1), not relevance: the goal isn't used · keep = leave as-is, summarize = worth shortening, drop = worth removing

  e1  bash       drop       score 0.00  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       drop       score 0.17  read package.json — saw the dependency list and script names
  e3  grep       summarize  score 0.33  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       summarize  score 0.50  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.67  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.83  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       keep       score 1.00  ran: ls public/audio — unrelated, was checking something el…

3 keep, 2 summarize, 2 drop (of 7 entries)
prune would remove the 2 entries marked drop, ~27 / 154 tokens (18%); the 2 entries marked summarize (~45 tokens) stay as they are unless you shorten them yourself
⚠ would remove the first entry (e1): this transcript has no user entry to protect as the original request
Scored by position alone (newest kept, like plain truncation) — no Jev call, nothing sent.
```

The default scorer, `recency`, is plain truncation: newer entries score higher, and the goal isn't
used. Here it keeps the unrelated `ls public/audio` because it's newest. `--scorer local` ranks by
keyword overlap with the goal instead, also offline:

```console
$ ctxjev analyze checkout-bug.json --scorer local
score: 0–1, how much an entry shares your goal's words, ranked within this transcript, blended with recency · keep = leave as-is, summarize = worth shortening, drop = worth removing

  e1  bash       summarize  score 0.45  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       drop       score 0.17  read package.json — saw the dependency list and script names
  e3  grep       keep       score 0.71  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       drop       score 0.20  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.74  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.98  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       drop       score 0.25  ran: ls public/audio — unrelated, was checking something el…

3 keep, 1 summarize, 3 drop (of 7 entries)
prune would remove 2 of the 3 entries marked drop, ~28 / 154 tokens (18%); the 1 entry marked summarize (~16 tokens) stays as it is unless you shorten it yourself
1 marked drop but kept: 1 protected in the last 2 entries
Scored offline by keyword overlap — no Jev call, nothing sent. It matches words only (no synonyms), so treat the decisions as a rough guide.
```

## Features

- **Built-in scorers, or your own:** `recency` (plain truncation, the default), `local`
  (keyword overlap), and `jev` (Jev's judgment of relevance to your goal; opt-in).
- **Pruning that keeps a request valid:** `pruneMessages()` removes a `tool_use` and its
  `tool_result` together, never touches the first message or the latest turn, keeps what the user
  wrote, and reports what the change costs a prompt cache.
- **A Claude Code plugin** that hands the highest-scoring entries back right after compaction.
- **An MCP server** with `score_relevance` and `prune_history` tools for any MCP host.
- **Secret masking** of common formats before anything is sent to Jev (best-effort, not exhaustive).
- **Token counts computed in code** with `gpt-tokenizer` (an approximation of Claude's tokenizer),
  never asked of Jev.

## Which one do I need?

| You want to… | Use | Sends anything by default? |
| --- | --- | --- |
| See how a transcript scores, or prune a saved one | [`ctxjev-cli`](packages/cli) | No |
| Drop stale history in an agent loop you write | [`ctxjev-core`](packages/core) | No |
| Keep key details through Claude Code's compaction | [the Claude Code plugin](packages/claude-plugin) | No |
| Give any MCP host scoring tools | [`ctxjev-mcp`](packages/mcp-server) | With a key set, masked excerpts to Jev unless a call picks `local` or `recency` |
| Use ctxjev from Codex | `ctxjev-mcp`, through the [Codex plugin](#codex) | Same as `ctxjev-mcp` |

## Install

Everything needs Node.js 20 or later.

```bash
npm install -g ctxjev-cli     # the ctxjev command
npm install ctxjev-core       # the library
```

`ctxjev-mcp` needs no install: your MCP host runs `npx ctxjev-mcp@0.7.2` (see [MCP server](#mcp-server)).

**Claude Code plugin.** In Claude Code (CLI or desktop app):

```
/plugin marketplace add x96x64/ctxjev
/plugin install ctxjev@ctxjev-plugins
```

It isn't on npm. The marketplace installs it from this repository at the latest release's tag, so
you get released code only.

**Jev (optional).** Get a key at [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys)
and set `TYPESAFE_API_KEY` in the environment ctxjev runs in.

## Usage

### CLI

`ctxjev analyze` prints a report; `ctxjev prune` writes a transcript back out with the entries
marked `drop` removed, to stdout or `--out <file>`. It reads ctxjev's own JSON format, an Anthropic
Messages conversation, or a Claude Code session `.jsonl` (analyze only), and detects which.

```console
$ ctxjev prune checkout-bug.json --out pruned.json
removed 2 of 7 entries, ~27 tokens · scored by position alone
⚠ removed the first entry (e1): this transcript has no user entry to protect as the original request
```

By default, `prune` never removes the first user entry or the last 2 entries of ctxjev's own
format, and never touches the first message or the latest turn of an Anthropic Messages
conversation. Every flag is in the [`ctxjev-cli` README](packages/cli/README.md).

### Library

```ts
import { pruneMessages } from 'ctxjev-core'

// `messages` is the Anthropic Messages conversation your agent loop sends each turn.
const { messages: pruned, removed } = await pruneMessages(
  messages,
  'Fix a bug where checkout charges customers twice on a slow network retry.',
)
// `pruned` is still a valid request. If your loop's only instruction is the first message, pass
// `protectLastTurn: false`, or that whole loop is the latest turn and nothing is removed.
```

Any other history shape works through `pruneContext(entries, goal)`, which takes plain
`{ id, role, toolName?, content, timestamp }` entries and returns a decision per entry. The full
API is in the [`ctxjev-core` README](packages/core/README.md).

### MCP server

`ctxjev-mcp` is a stdio MCP server whose tools are `score_relevance` (a score per entry) and
`prune_history` (a keep/drop/summarize decision per entry, plus a savings report).

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2   # Claude Code
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2    # Codex
```

Leave out `--env TYPESAFE_API_KEY=...` to use it offline only. An MCP tool can't remove anything
from its host's own context, and the agent pays output tokens to send its history as arguments,
so calling it doesn't save tokens by itself. It's for agent frameworks that act on the scores.
Setup for other hosts is in the [`ctxjev-mcp` README](packages/mcp-server/README.md).

### Claude Code plugin

Claude Code hooks can read the transcript but can't rewrite it, so the plugin works alongside
Claude Code's own compaction:

```
PreCompact             → score the entries since the last compaction; cache the top few
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a short digest; Claude Code adds it to context
```

It scores against your first request plus your latest instruction, or against a goal you set with
`/ctxjev:set-goal <text>` (for this session, through compactions). `/ctxjev:status` shows the goal,
what the last run did and why, and what was kept. More in the
[plugin README](packages/claude-plugin/README.md).

### Codex

Codex uses ctxjev through `ctxjev-mcp`, as MCP tools. Either run the `codex mcp add` line above, or
install the plugin bundle in this repository, which registers the same server and tells Codex to
pass your `TYPESAFE_API_KEY` through to it (`env_vars`):

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

That's all Codex gets: there is no Codex counterpart of the Claude Code plugin's compaction hooks,
and ctxjev doesn't read Codex's own session logs.

## Configuration

| Scorer | Ranks by | Uses the goal | Sends anything | Default in |
| --- | --- | --- | --- | --- |
| `recency` | Position: oldest 0, newest 1 (plain truncation) | No | No | CLI, library |
| `local` | Keyword overlap with the goal, ranked within the batch | Yes | No | Claude Code plugin |
| `jev` | Jev's yes/no judgment of relevance to the goal | Yes | Masked excerpts and the goal, to TypeSafe AI | MCP tools |

`local` and `jev` blend their relevance with each entry's position: `recencyWeight` (default `0.1`)
is how much position counts. An entry whose score is below `dropBelow` (default `0.3`) is marked
`drop`, below `summarizeBelow` (default `0.6`) `summarize`, and anything else `keep`.

| Environment variable | Used by | What it does |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | everything that calls Jev | Your Jev key. A value that's only an unexpanded placeholder, such as `${TYPESAFE_API_KEY}`, counts as no key. |
| `CTXJEV_SCORER` | Claude Code plugin | `jev` to opt in to Jev; anything else scores offline. |
| `CTXJEV_PRESERVE_LIMIT` | Claude Code plugin | How many entries to carry through a compaction, 1 to 50 (default 5). |
| `CTXJEV_STATE_DIR` | Claude Code plugin | Where it keeps its state (default `~/.claude/ctxjev`). |

## How it works

- **One request per batch.** With Jev, each entry becomes a yes/no question, and up to 50 are asked
  at once against one shared state. Each batch also sees the latest activity, so an old failing
  test is judged knowing a later run fixed it.
- **Recency is relative to the batch**, not to the clock, so a saved transcript scores the same as
  a live one.
- **Jev is never asked to count or write.** Token counts come from a tokenizer, and the
  keep/drop/summarize decision is a plain threshold on Jev's score.
- **Savings count what's actually removed**, at each entry's full size, not the excerpt that was
  scored.

The reasoning behind each choice is in [docs/design-notes.md](docs/design-notes.md).

## Privacy

- With `recency` or `local`, nothing is sent anywhere.
- With `jev`, the goal and a short excerpt of each entry (not whole files or full tool output) are
  sent to TypeSafe AI's Jev API. Common secret formats are replaced with `[REDACTED]` first, and
  entry ids aren't sent at all. The masking is pattern matching: it narrows exposure but can't
  recognize every secret, so don't point `--scorer jev` at a sensitive log without checking it.
- The Claude Code plugin keeps its state in `~/.claude/ctxjev/`, readable only by you, never in
  your project. The CLI's score cache is `~/.cache/ctxjev/score-cache.json` and holds hashes, not
  transcript text.

How well the masking works, measured on lines written without sight of its code, is in
[docs/evaluation.md](docs/evaluation.md#secret-masking-measured-blind). To report a leak, see
[SECURITY.md](SECURITY.md).

## Status and limits

<!-- checked-prose -->
ctxjev does what this page describes, but whether that helps an agent finish its work hasn't been
shown. In a [preregistered comparison](docs/evaluation.md) on <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> tasks the design had
never seen, an agent given history pruned by Jev's ranking finished the same share of tasks as an
agent given plain truncation (difference in percentage points, with its 95% CI:
<!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku --> with Claude Haiku 4.5, <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet --> with Claude Sonnet 5). On the
preregistered measure of what each task needed, Jev's ranking kept <!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev --> under a tight budget, less than a random
ordering of the same entries (<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->). The Claude Code plugin's digest has no
demonstrated effect either. That is why everything but the MCP tools scores offline by default.
The tasks are small, and the held-out set is now used up; [docs/evaluation.md](docs/evaluation.md)
has every number, how it was produced, and what it can't show.
<!-- /checked-prose -->

## Documentation

- [docs/evaluation.md](docs/evaluation.md): what has and hasn't been measured
- [docs/design-notes.md](docs/design-notes.md): why it works the way it does
- Package READMEs: [`ctxjev-core`](packages/core/README.md), [`ctxjev-cli`](packages/cli/README.md),
  [`ctxjev-mcp`](packages/mcp-server/README.md), [Claude Code plugin](packages/claude-plugin/README.md)
- [CHANGELOG.md](CHANGELOG.md) and [ROADMAP.md](ROADMAP.md)

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the rules
every change follows, and how releases are made; [AGENTS.md](AGENTS.md) has the same rules in full,
for AI coding agents and people alike.

```bash
pnpm install && pnpm build && pnpm test
```

## Security

Please report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes, not in a public
issue.

## License

[MIT](LICENSE). ctxjev is an independent project, not affiliated with or endorsed by TypeSafe AI
or Anthropic. It's built on [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) and
Anthropic's [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk);
every direct dependency is under MIT or ISC. A few of their own dependencies are BSD-licensed
(`fast-uri`, `qs`, `json-schema-typed`) and ask you to keep their notices too;
`pnpm licenses list --prod` lists every one. The Claude Code plugin bundles code from
`@typesafe-ai/sdk` and ships its notice in
[`THIRD_PARTY_NOTICES`](packages/claude-plugin/THIRD_PARTY_NOTICES).
