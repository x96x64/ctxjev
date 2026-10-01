# ctxjev

[en](https://github.com/x96x64/ctxjev/blob/main/README.md) | **ja** | [zh](https://github.com/x96x64/ctxjev/blob/main/README.zh.md) | [es](https://github.com/x96x64/ctxjev/blob/main/README.es.md) | [ko](https://github.com/x96x64/ctxjev/blob/main/README.ko.md) | [pt](https://github.com/x96x64/ctxjev/blob/main/README.pt.md) | [fr](https://github.com/x96x64/ctxjev/blob/main/README.fr.md) | [de](https://github.com/x96x64/ctxjev/blob/main/README.de.md)

<!-- translation-source: README.md sha256=04b2c884329cd3020edab16406a515b2aa4981a636c0fcbb0254b636d28d8ee0 -->
> 英語版の README から翻訳したものです。内容が食い違う場合は、英語版が正本です。

**AI エージェントの履歴を採点し、何を残し、何を削り、何を要約するかを決めます。既定ではオフラインで動き、
選べば TypeSafe AI の [Jev](https://typesafe.ai) も使えます。**

[![npm: ctxjev-core](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm: ctxjev-cli](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm: ctxjev-mcp](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-core.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-core.svg)](https://nodejs.org)

- **既定では、何もマシンの外に出ません。** CLI、ライブラリ、Claude Code プラグインのどれでも同じです。
  Jev は自分で選んだときだけ使われ（`--scorer jev`、`scorer: 'jev'`、`CTXJEV_SCORER=jev`）、`TYPESAFE_API_KEY` が必要です。
- **MCP サーバーだけは例外です。** 呼び出しが `scorer: "local"` か `"recency"` を指定しない限り、ツールは Jev を使います。
- **効果はまだ示されていません。** 設計に使っていない課題（ホールドアウト）では、どの採点方式も、単純な切り詰めより多くの課題をエージェントに完了させることは示されていません。
  [状態と限界](#状態と限界)を参照してください。

## 30 秒で試す

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

既定の採点方式 `recency` は単純な切り詰めです。新しい項目ほど点が高く、目標（goal）は使いません。
この例では、無関係な `ls public/audio` も、いちばん新しいという理由で残っています。`--scorer local` は、代わりに目標とのキーワードの重なりで順位を付けます。これもオフラインです。

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

## 特徴

- **組み込みの採点方式、または自作の関数:** `recency`（単純な切り詰め。既定）、`local`
  （キーワードの重なり）、`jev`（目標との関連度についての Jev の判断。選んだときだけ）。
- **API リクエストとして有効なまま削る:** `pruneMessages()` は `tool_use` とその `tool_result` を一緒に取り除き、
  最初のメッセージと最新のターンには触れず、ユーザーが書いた文を残し、プロンプトキャッシュへの影響を報告します。
- **Claude Code プラグイン:** 圧縮の直後に、点数の高い項目を戻します。
- **MCP サーバー:** どの MCP ホストからも使える `score_relevance` と `prune_history` のツール。
- **秘密のマスク:** Jev に何かを送る前に、よくある形式の秘密を隠します（ベストエフォートで、完全ではありません）。
- **トークン数はコードで計算:** `gpt-tokenizer`（Claude のトークナイザーの近似）を使い、Jev には数えさせません。

## どれを使えばいい？

| したいこと | 使うもの | 既定で何かを送るか |
| --- | --- | --- |
| 記録の採点を見る、保存した記録を削る | [`ctxjev-cli`](packages/cli) | いいえ |
| 自分で書くエージェントのループで、古い履歴を削る | [`ctxjev-core`](packages/core) | いいえ |
| Claude Code の圧縮を経ても、大事な細部を残したい | [Claude Code プラグイン](packages/claude-plugin) | いいえ |
| MCP ホストに採点のツールを足す | [`ctxjev-mcp`](packages/mcp-server) | キーがあれば、呼び出しが `local` か `recency` を選ばない限り、マスク済みの抜粋を Jev に送る |
| Codex から使う | [Codex プラグイン](#codex)経由の `ctxjev-mcp` | `ctxjev-mcp` と同じ |

## 導入

どれも Node.js 20 以上が必要です。

```bash
npm install -g ctxjev-cli     # the ctxjev command
npm install ctxjev-core       # the library
```

`ctxjev-mcp` は導入不要です。MCP ホストが `npx ctxjev-mcp@0.7.2` を実行します（[MCP サーバー](#mcp-サーバー)を参照）。

**Claude Code プラグイン。** Claude Code（CLI またはデスクトップアプリ）で:

```
/plugin marketplace add x96x64/ctxjev
/plugin install ctxjev@ctxjev-plugins
```

npm にはありません。マーケットプレイスは、このリポジトリの最新リリースのタグから導入するので、
リリース済みのコードだけが届きます。

**Jev（任意）。** [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys) でキーを取得し、
ctxjev を動かす環境に `TYPESAFE_API_KEY` を設定します。

## 使い方

### CLI

`ctxjev analyze` は報告を表示し、`ctxjev prune` は `drop` と判定された項目を除いた記録を、
標準出力か `--out <file>` に書き出します。ctxjev 独自の JSON 形式、Anthropic Messages の会話、
Claude Code のセッションの `.jsonl`（analyze のみ）を読み、どれかは自動で判別します。

```console
$ ctxjev prune checkout-bug.json --out pruned.json
removed 2 of 7 entries, ~27 tokens · scored by position alone
⚠ removed the first entry (e1): this transcript has no user entry to protect as the original request
```

既定では、`prune` は ctxjev 独自の形式の最初のユーザー項目と最後の 2 項目を決して削らず、
Anthropic Messages の会話では最初のメッセージと最新のターンに触れません。すべてのフラグは
[`ctxjev-cli` の README](packages/cli/README.md) にあります。

### ライブラリ

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

ほかの形の履歴は `pruneContext(entries, goal)` で扱えます。これは単純な
`{ id, role, toolName?, content, timestamp }` の項目を受け取り、項目ごとの判定を返します。API の全体は
[`ctxjev-core` の README](packages/core/README.md) にあります。

### MCP サーバー

`ctxjev-mcp` は stdio の MCP サーバーで、ツールは `score_relevance`（項目ごとの点数）と
`prune_history`（項目ごとの keep/drop/summarize の判定と、節約の報告）です。

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2   # Claude Code
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2    # Codex
```

オフラインだけで使うなら `--env TYPESAFE_API_KEY=...` を外してください。MCP のツールは、ホスト自身のコンテキストから何も取り除けません。
また、エージェントは履歴を引数として送るために出力トークンを払うので、呼ぶだけではトークンは節約されません。
点数に基づいて動くエージェントのフレームワーク向けです。ほかのホストの設定は
[`ctxjev-mcp` の README](packages/mcp-server/README.md) にあります。

### Claude Code プラグイン

Claude Code のフックは記録（トランスクリプト）を読めますが、書き換えはできません。そのためプラグインは、
Claude Code 自身の圧縮と併せて動きます:

```
PreCompact             → score the entries since the last compaction; cache the top few
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a short digest; Claude Code adds it to context
```

採点の基準は、最初の依頼と最新の指示、または `/ctxjev:set-goal <text>` で設定した目標です
（このセッションの間、圧縮をまたいで有効）。`/ctxjev:status` は、目標、前回の実行が何をしたかとその理由、
残した項目を表示します。詳しくは[プラグインの README](packages/claude-plugin/README.md) を参照してください。

### Codex

Codex は `ctxjev-mcp` を MCP のツールとして使います。上の `codex mcp add` の行を実行するか、
このリポジトリのプラグインを導入してください。プラグインは同じサーバーを登録し、
`TYPESAFE_API_KEY` をサーバーに渡すよう Codex に指示します（`env_vars`）:

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

Codex で使えるのはここまでです。Claude Code プラグインの圧縮フックに当たるものは Codex 向けにはなく、
ctxjev は Codex 自身のセッションのログを読みません。

## 設定

| 採点方式 | 順位の付け方 | 目標を使うか | 何かを送るか | 既定になっている所 |
| --- | --- | --- | --- | --- |
| `recency` | 位置: 最も古い 0、最も新しい 1（単純な切り詰め） | いいえ | いいえ | CLI、ライブラリ |
| `local` | 目標とのキーワードの重なり。バッチの中で順位付け | はい | いいえ | Claude Code プラグイン |
| `jev` | 目標との関連度についての Jev の yes/no の判断 | はい | マスク済みの抜粋と目標を TypeSafe AI へ | MCP のツール |

`local` と `jev` は、関連度に各項目の位置を混ぜます。位置をどれだけ重く見るかが `recencyWeight`（既定 `0.1`）です。
点数が `dropBelow`（既定 `0.3`）より低い項目は `drop`、`summarizeBelow`（既定 `0.6`）より低い項目は
`summarize`、それ以外は `keep` になります。

| 環境変数 | 使うもの | 働き |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Jev を呼ぶものすべて | Jev のキー。`${TYPESAFE_API_KEY}` のような、展開されていないプレースホルダーだけの値は、キー無しとみなします。 |
| `CTXJEV_SCORER` | Claude Code プラグイン | `jev` で Jev を使う。それ以外はオフラインで採点。 |
| `CTXJEV_PRESERVE_LIMIT` | Claude Code プラグイン | 圧縮を越えて運ぶ項目の数。1 から 50（既定 5）。 |
| `CTXJEV_STATE_DIR` | Claude Code プラグイン | 状態を保存する場所（既定 `~/.claude/ctxjev`）。 |

## 仕組み

- **リクエストはバッチ単位でまとめて送る。** Jev では各項目が yes/no の質問になり、最大 50 個を、共通の状態に対して一度に問います。
  各バッチは最新の作業の状況も見るので、以前に失敗したテストも、後の実行で直ったことを踏まえて判断されます。
- **新しさはバッチの中で相対的に決まり**、実際の時刻には依りません。保存した記録も、進行中の記録と同じ点数になります。
- **Jev には数えさせず、文章も書かせません。** トークン数はトークナイザーで数え、
  keep/drop/summarize の判定は Jev の点数に単純なしきい値を当てただけです。
- **節約量は実際に取り除いた分を数えます。** 採点した抜粋ではなく、各項目の元の大きさで数えます。

それぞれの選択の理由は [docs/design-notes.md](docs/design-notes.md) にあります。

## プライバシー

- `recency` と `local` では、どこにも何も送りません。
- `jev` では、目標と各項目の短い抜粋（ファイル全体やツールの出力の全体ではありません）を TypeSafe AI の Jev API に送ります。
  先によくある形式の秘密を `[REDACTED]` に置き換え、項目の ID は一切送りません。マスクはパターンの照合なので、
  漏れを減らしはしますが、すべての秘密は見分けられません。中身を確かめずに、機密を含む記録に `--scorer jev` を使わないでください。
- Claude Code プラグインは状態を `~/.claude/ctxjev/` に保存します。本人だけが読め、プロジェクトの中には置きません。
  CLI の点数のキャッシュは `~/.cache/ctxjev/score-cache.json` で、記録の本文ではなくハッシュを保存します。

マスクのコードを見ずに書かれた行で測った、マスクの効き具合は
[docs/evaluation.md](docs/evaluation.md#secret-masking-measured-blind) にあります。漏れを報告するときは
[SECURITY.md](SECURITY.md) を参照してください。

## 状態と限界

ctxjev はこのページに書いたとおりに動きますが、それがエージェントの作業の完了に役立つかは示されていません。
設計に使っていない <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> 個の課題での[事前登録した比較](docs/evaluation.md)では、
Jev の順位で削った履歴を渡したエージェントと、単純な切り詰めの履歴を渡したエージェントで、課題を完了した割合は同じでした
（差はパーセントポイントで、95% CI 付き: Claude Haiku 4.5 で <!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku -->、Claude Sonnet 5 で <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet -->）。
事前登録した指標（各課題に必要だった情報をどれだけ残せたか）では、厳しい予算の下で Jev の順位付けが残せたのは
<!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev --> で、同じ項目をランダムに並べた場合（<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->）を下回りました。Claude Code プラグインの
ダイジェストにも、示された効果はありません。そのため、MCP のツール以外はすべて、既定でオフラインで採点します。
課題は小さく、ホールドアウトの課題セットは使い切りました。すべての数値、その出し方、示せないことは
[docs/evaluation.md](docs/evaluation.md) にあります。

## ドキュメント

- [docs/evaluation.md](docs/evaluation.md): 何が測られ、何が測られていないか
- [docs/design-notes.md](docs/design-notes.md): なぜこの作りなのか
- パッケージの README: [`ctxjev-core`](packages/core/README.md)、[`ctxjev-cli`](packages/cli/README.md)、
  [`ctxjev-mcp`](packages/mcp-server/README.md)、[Claude Code プラグイン](packages/claude-plugin/README.md)
- [CHANGELOG.md](CHANGELOG.md) と [ROADMAP.md](ROADMAP.md)

## 貢献

issue とプルリクエストを歓迎します。[CONTRIBUTING.md](CONTRIBUTING.md) に、開発環境の準備、すべての変更が従う決まり、
リリースの手順があります。[AGENTS.md](AGENTS.md) には、AI のコーディングエージェントと人の両方に向けて、同じ決まりの全文があります。

```bash
pnpm install && pnpm build && pnpm test
```

## セキュリティ

脆弱性は、公開の issue ではなく、[SECURITY.md](SECURITY.md) に書かれた方法で非公開で報告してください。

## ライセンス

[MIT](LICENSE)。ctxjev は独立したプロジェクトで、TypeSafe AI や Anthropic とは提携しておらず、
承認も受けていません。[`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) と、Anthropic の
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) の上に作られています。
直接の依存はすべて MIT か ISC です。それらが依存するパッケージのいくつか（`fast-uri`、`qs`、`json-schema-typed`）は BSD ライセンスで、
それらのライセンス表示も残すよう求めています。`pnpm licenses list --prod` ですべてを一覧できます。Claude Code プラグインは
`@typesafe-ai/sdk` のコードを同梱し、そのライセンス表示を [`THIRD_PARTY_NOTICES`](packages/claude-plugin/THIRD_PARTY_NOTICES) に入れています。
