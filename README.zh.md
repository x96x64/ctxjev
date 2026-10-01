# ctxjev

[en](https://github.com/x96x64/ctxjev/blob/main/README.md) | [ja](https://github.com/x96x64/ctxjev/blob/main/README.ja.md) | **zh** | [es](https://github.com/x96x64/ctxjev/blob/main/README.es.md) | [ko](https://github.com/x96x64/ctxjev/blob/main/README.ko.md) | [pt](https://github.com/x96x64/ctxjev/blob/main/README.pt.md) | [fr](https://github.com/x96x64/ctxjev/blob/main/README.fr.md) | [de](https://github.com/x96x64/ctxjev/blob/main/README.de.md)

<!-- translation-source: README.md sha256=ae7f159f1a78a3c17cc3e875c17eba4968fa5a795a47161d1f19a3ca68bdb039 -->
> 本文由英文 README 翻译而来（简体中文）。如有出入，以英文版为准。

**为 AI 智能体的历史记录打分，并决定保留、删除或概括哪些内容：默认离线运行，也可以选择使用
TypeSafe AI 的 [Jev](https://typesafe.ai)。**

[![npm: ctxjev-core](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm: ctxjev-cli](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm: ctxjev-mcp](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-core.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-core.svg)](https://nodejs.org)

- **默认情况下，任何数据都不会离开你的机器**：CLI、库、MCP 服务器和 Claude Code 插件都是如此。
  Jev 需要主动启用（`--scorer jev`、`scorer: 'jev'`、`scorer: "jev"`、`CTXJEV_SCORER=jev`），并且需要 `TYPESAFE_API_KEY`。
- **效果尚未得到证明**：在留出（held-out）任务上，没有任何打分方式被证明能比单纯截断让智能体完成更多任务。
  参见[现状与局限](#现状与局限)。

## 30 秒上手

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

默认的打分方式 `recency` 就是单纯截断：越新的条目得分越高，不使用目标（goal）。
在这个例子里，无关的 `ls public/audio` 也因为最新而被保留。`--scorer local` 则改为按与目标的关键词重叠来排序，同样离线运行：

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

## 功能

- **内置打分方式，或你自己的函数**：`recency`（单纯截断，默认）、`local`
  （关键词重叠）和 `jev`（Jev 对条目与目标相关性的判断；需主动启用）。
- **删减后请求依然有效**：`pruneMessages()` 会把 `tool_use` 和对应的 `tool_result` 一起删除，
  从不改动第一条消息和最新一轮，保留用户写下的内容，并报告这次改动对提示缓存（prompt cache）的影响。
- **Claude Code 插件**：在压缩（compaction）完成后立即把得分最高的条目重新放回上下文。
- **MCP 服务器**：提供 `score_relevance` 和 `prune_history` 工具，任何 MCP 宿主都能使用。
- **敏感信息脱敏**：在向 Jev 发送任何内容之前，对常见格式的密钥和口令进行脱敏（尽力而为，并不完备）。
- **token 数由代码计算**：使用 `gpt-tokenizer`（Claude 分词器的近似），从不让 Jev 计数。

## 我该用哪个？

| 你想要… | 使用 | 默认会发送数据吗？ |
| --- | --- | --- |
| 查看一份记录如何打分，或删减已保存的记录 | [`ctxjev-cli`](packages/cli) | 否 |
| 在自己编写的智能体循环中删除过时的历史 | [`ctxjev-core`](packages/core) | 否 |
| 在 Claude Code 压缩后仍保留关键细节 | [Claude Code 插件](packages/claude-plugin) | 否 |
| 为任意 MCP 宿主提供打分工具 | [`ctxjev-mcp`](packages/mcp-server) | 否：只有传入 `scorer: "jev"` 的调用才会发送 |
| 在 Codex 中使用 ctxjev | 通过 [Codex 插件](#codex) 使用 `ctxjev-mcp` | 与 `ctxjev-mcp` 相同 |

## 安装

全部需要 Node.js 20 或更高版本。

```bash
npm install -g ctxjev-cli     # the ctxjev command
npm install ctxjev-core       # the library
```

`ctxjev-mcp` 无需安装：由你的 MCP 宿主运行 `npx ctxjev-mcp@0.7.2`（参见 [MCP 服务器](#mcp-服务器)）。

**Claude Code 插件。** 在 Claude Code（CLI 或桌面应用）中：

```
/plugin marketplace add x96x64/ctxjev
/plugin install ctxjev@ctxjev-plugins
```

它不在 npm 上。插件市场从本仓库最新发布版本的标签安装它，因此你拿到的只会是已发布的代码。

**Jev（可选）。** 在 [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys) 获取密钥，
并在运行 ctxjev 的环境中设置 `TYPESAFE_API_KEY`。

## 用法

### CLI

`ctxjev analyze` 输出一份报告；`ctxjev prune` 把去掉标记为 `drop` 的条目后的记录写出，
输出到标准输出或 `--out <file>`。它能读取 ctxjev 自己的 JSON 格式、Anthropic Messages 对话，
以及 Claude Code 会话的 `.jsonl`（仅 analyze），并自动识别是哪一种。

```console
$ ctxjev prune checkout-bug.json --out pruned.json
removed 2 of 7 entries, ~27 tokens · scored by position alone
⚠ removed the first entry (e1): this transcript has no user entry to protect as the original request
```

默认情况下，`prune` 从不删除 ctxjev 自有格式中的第一条用户条目和最后 2 个条目，
也从不改动 Anthropic Messages 对话的第一条消息和最新一轮。所有参数见 [`ctxjev-cli` 的 README](packages/cli/README.md)。

### 库

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

其他形式的历史可以通过 `pruneContext(entries, goal)` 处理：它接收普通的
`{ id, role, toolName?, content, timestamp }` 条目，并为每个条目返回一个判定。完整 API 见
[`ctxjev-core` 的 README](packages/core/README.md)。

### MCP 服务器

`ctxjev-mcp` 是一个 stdio MCP 服务器，提供的工具是 `score_relevance`（每个条目一个分数）和
`prune_history`（每个条目一个 keep/drop/summarize 判定，外加节省情况报告）。

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2   # Claude Code
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2    # Codex
```

除非调用传入 `scorer: "jev"`，这些工具都离线打分（`local`）；如果你从不想用 Jev，去掉 `--env TYPESAFE_API_KEY=...` 即可。MCP 工具无法从宿主自身的上下文中删除任何内容，
而且智能体要把历史作为参数发送，需要为此支付输出 token，所以单纯调用它并不会节省 token。
它适用于会根据分数采取行动的智能体框架。其他宿主的配置见 [`ctxjev-mcp` 的 README](packages/mcp-server/README.md)。

### Claude Code 插件

Claude Code 的钩子（hook）可以读取会话记录，但不能改写它，因此插件配合 Claude Code 自身的压缩工作：

```
PreCompact             → score the entries since the last compaction; cache the top few
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a short digest; Claude Code adds it to context
```

它依据你的第一个请求加上最新的指示来打分，或者依据你用 `/ctxjev:set-goal <text>` 设定的目标
（在本会话中跨压缩有效）。`/ctxjev:status` 显示目标、上一次运行做了什么及原因，以及保留了哪些内容。
详见[插件的 README](packages/claude-plugin/README.md)。

### Codex

Codex 通过 `ctxjev-mcp` 以 MCP 工具的形式使用 ctxjev。可以运行上面的 `codex mcp add` 那一行，
也可以安装本仓库中的插件包：它注册同一个服务器，并让 Codex 把你的 `TYPESAFE_API_KEY` 传给它（`env_vars`）：

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

Codex 能用的就是这些：Codex 没有与 Claude Code 插件的压缩钩子对应的功能，ctxjev 也不读取 Codex 自己的会话日志。

## 配置

| 打分方式 | 排序依据 | 使用目标 | 是否发送数据 | 默认用于 |
| --- | --- | --- | --- | --- |
| `recency` | 位置：最旧为 0，最新为 1（单纯截断） | 否 | 否 | CLI、库 |
| `local` | 与目标的关键词重叠，在批次内排序 | 是 | 否 | Claude Code 插件、MCP 工具 |
| `jev` | Jev 对与目标是否相关的是/否判断 | 是 | 脱敏后的摘录和目标，发往 TypeSafe AI | 无：需主动启用 |

`local` 和 `jev` 会把相关性与每个条目的位置混合：`recencyWeight`（默认 `0.1`）决定位置占多大比重。
得分低于 `dropBelow`（默认 `0.3`）的条目标记为 `drop`，低于 `summarizeBelow`（默认 `0.6`）的标记为
`summarize`，其余为 `keep`。

| 环境变量 | 使用者 | 作用 |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | 所有调用 Jev 的部分 | 你的 Jev 密钥。只是一个未展开的占位符（例如 `${TYPESAFE_API_KEY}`）的值视为没有密钥。 |
| `CTXJEV_SCORER` | Claude Code 插件 | 设为 `jev` 以启用 Jev；其他值都离线打分。 |
| `CTXJEV_PRESERVE_LIMIT` | Claude Code 插件 | 每次压缩要带过去的条目数，1 到 50（默认 5）。 |
| `CTXJEV_STATE_DIR` | Claude Code 插件 | 保存状态的位置（默认 `~/.claude/ctxjev`）。 |

## 工作原理

- **按批次请求。** 使用 Jev 时，每个条目变成一个是/否问题，最多 50 个问题针对同一个共享状态一次提出。
  每个批次还能看到最新的进展，因此早先失败的测试会在“后来的运行已修好它”的前提下被评判。
- **新旧程度是批次内的相对值**，与实际时间无关，所以保存下来的记录和正在进行的记录得分相同。
- **从不让 Jev 计数或生成文本。** token 数由分词器计算，keep/drop/summarize 的判定只是对 Jev 的分数套用一个简单阈值。
- **节省量按实际删除的内容计算**，以每个条目的完整大小计，而不是被打分的摘录。

每个设计选择背后的理由见 [docs/design-notes.md](docs/design-notes.md)。

## 隐私

- 使用 `recency` 或 `local` 时，不会向任何地方发送任何内容。
- 使用 `jev` 时，目标和每个条目的简短摘录（不是整个文件或完整的工具输出）会被发送到 TypeSafe AI 的 Jev API。
  常见格式的密钥会先被替换为 `[REDACTED]`，条目 ID 完全不发送。脱敏靠的是模式匹配：它能减少暴露，
  但无法识别所有密钥，所以在检查内容之前，不要把 `--scorer jev` 用在敏感的日志上。
- Claude Code 插件把状态保存在 `~/.claude/ctxjev/`，只有你本人可读，从不放在你的项目里。
  CLI 的分数缓存是 `~/.cache/ctxjev/score-cache.json`，保存的是哈希值，而不是记录正文。

脱敏效果如何（在编写者没有看过脱敏代码的文本行上测得）见
[docs/evaluation.md](docs/evaluation.md#secret-masking-measured-blind)。如需报告泄露，请参阅 [SECURITY.md](SECURITY.md)。

## 现状与局限

ctxjev 的行为与本页描述一致，但它是否能帮助智能体完成工作尚未得到证明。
在一项针对设计时从未见过的 <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> 个任务的[预注册比较](docs/evaluation.md)中，
拿到按 Jev 排序删减后历史的智能体，与拿到单纯截断历史的智能体，完成任务的比例相同
（差值以百分点表示，附 95% CI：Claude Haiku 4.5 为 <!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku -->，Claude Sonnet 5 为 <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet -->）。
按预注册的衡量方式，在紧张的预算下，Jev 的排序保留了每个任务所需内容的 <!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev -->，
少于把同样条目随机排列时的结果（<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->）。Claude Code 插件的摘要（digest）同样没有经过证实的效果。
这就是所有入口默认都离线打分的原因。这些任务规模很小，而留出集现在已经用完；
所有数字、它们的得出方式以及它们无法说明的内容，都在 [docs/evaluation.md](docs/evaluation.md) 中。

## 文档

- [docs/evaluation.md](docs/evaluation.md)：哪些已经测量过，哪些还没有
- [docs/design-notes.md](docs/design-notes.md)：为什么这样设计
- 各包的 README：[`ctxjev-core`](packages/core/README.md)、[`ctxjev-cli`](packages/cli/README.md)、
  [`ctxjev-mcp`](packages/mcp-server/README.md)、[Claude Code 插件](packages/claude-plugin/README.md)
- [CHANGELOG.md](CHANGELOG.md) 和 [ROADMAP.md](ROADMAP.md)

## 参与贡献

欢迎提交 issue 和拉取请求。[CONTRIBUTING.md](CONTRIBUTING.md) 介绍了环境搭建、每项改动都要遵守的规则以及发布流程；
[AGENTS.md](AGENTS.md) 包含同样规则的完整版本，面向 AI 编码智能体，也面向人。

```bash
pnpm install && pnpm build && pnpm test
```

## 安全

请按照 [SECURITY.md](SECURITY.md) 的说明私下报告漏洞，不要在公开 issue 中报告。

## 许可证

[MIT](LICENSE)。ctxjev 是独立项目，与 TypeSafe AI 和 Anthropic 无隶属关系，也未获得其认可。
它基于 [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) 和 Anthropic 的
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) 构建；
所有直接依赖均采用 MIT 或 ISC 许可证。它们自身的少数依赖（`fast-uri`、`qs`、`json-schema-typed`）采用 BSD 许可证，
同样要求保留其声明；`pnpm licenses list --prod` 会列出全部依赖。Claude Code 插件打包了来自 `@typesafe-ai/sdk` 的代码，
并在 [`THIRD_PARTY_NOTICES`](packages/claude-plugin/THIRD_PARTY_NOTICES) 中附带其声明。
