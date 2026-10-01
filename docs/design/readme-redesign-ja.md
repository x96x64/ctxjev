# README の作り直しと 1.0 に向けた設計（Round 6）

この文書はオーナー向けの設計案です。承認をいただいてから、英語の README と関連文書を書き直します。

- **用語**
  - **README**：リポジトリやパッケージの入口になる説明書。GitHub と npm のページに表示されます。
  - **バッジ**：README の先頭に並ぶ小さな画像（最新版の番号、CI の合否など）。サービスが自動で描きます。
  - **npm ページ**：`npmjs.com/package/<名前>` のページ。パッケージのフォルダの中にある README だけが表示されます。
  - **相対リンク**：`../../README.md` のような、リポジトリの中の位置を基準にしたリンク。npm のページでは壊れます。
  - **MCP**：AI のアプリ（Claude Code、Codex など）に外部の道具を足すための共通の方式。
  - **フック**：アプリの決まった瞬間（圧縮の直前など）に自動で走る小さなプログラム。
  - **圧縮（compaction）**：会話が長くなったとき、アプリが過去の会話を要約に置き換えること。

## 1. 他のプロジェクトの README から学んだこと（構成だけ）

調べたもの：ripgrep、prettier、vite、zod、vitest、bat、ruff、execa の README（2026-10-01 の各リポジトリの既定ブランチ）。文章は使わず、構成と書き方の習慣だけを抜き出しました。

| 習慣 | 例 | ctxjev での使い方 |
| --- | --- | --- |
| 先頭は「名前・一行の説明・バッジ」だけ | ruff、ripgrep、zod | 一行の説明と、本物のバッジ4種（npm の版、CI、ライセンス、Node） |
| 説明より先に実例（入力と出力） | prettier の Input/Output、ripgrep の画面例 | 30秒の例：導入 → 実行 → 実際の出力 |
| 特徴は短い箇条書き | ruff、vitest、execa | 5〜6行 |
| 詳しい話は別の文書へ | ripgrep の GUIDE.md・FAQ.md、vite・zod の公式サイト | 評価の詳細は `docs/evaluation.md` へ |
| 「使うべきでない場合」を正直に書く | ripgrep の "Why shouldn't I use ripgrep?" | 「状態と限界」の節に、効果が示されていないことを1段落で |
| 複数パッケージは表で案内 | vite の Packages | 入口ごとの表（CLI、ライブラリ、MCP、Claude Code、Codex） |
| 翻訳への入口を置く | ripgrep の Translations | 先頭に言語の切り替え行 |
| README は短い | vite 66行、prettier 104行、zod 218行 | 今の 595 行を 250 行前後に |

## 2. 今の文書で、開発日誌やチャットの名残に見えるところ

### ルートの README.md

- 冒頭の「In five lines」の箱の最後に、開発者向けの注意（`pnpm build` しないと `.mcp.json` が動かない）が入っている。利用者には不要。
- 出力例の「captured 2026-09-25」という日付。
- 「Does It Work?」の節が全体の約3分の1（約200行）。中身は、dev／holdout、事前登録（preregistration）、ラン `d8aa0b1`／`042cf4c`、「2026-09-25 に復元」、0.4.0／0.5.0 との比較、独立監査（日本語）へのリンクなど、開発の経緯の説明が中心。
- 「Round 2 design proposal（in Japanese）」「Round 3's corpus」などの回の名前。
- パッケージ表の「Status」列（`✅ published (npm: 0.7.2)`）。版番号が手書きで、いずれ古くなる。
- 「(`v0.7.2`)」の手書きの版番号。
- TypeScript と pnpm のバッジ。状態を表さない飾りなので外す（依頼の「本物のバッジだけ」に合わせる）。
- Jev に頼まないことの一覧を `CLAUDE.md`（AI 向けの開発指示）へ案内している。利用者向けの文書ではない。
- Quick Start（使い始め方）が 415 行目と遅い。

### パッケージの README（npm のページになるもの）

- **core**：`../../README.md` や `eval/PREREGISTRATION.md` への相対リンク（npm では壊れる。後者は tarball に入っていない）。「設計の話は main の README に」と書いてあるが、その節は消える予定。
- **cli**：「Versions before 0.6.0 score with Jev by default…」という昔の版の注意。「captured 2026-09-25」。相対リンク。
- **mcp-server**：「as before 0.7.1」「(0.7.1 returned the raw overlap here)」という版の経緯。「verified against codex-cli v0.155.1」「Claude Code v2.1.278 で承認の手順が出なかった」という検証メモ。リポジトリの開発者向けの `.mcp.json` の話。
- **claude-plugin**：「Verified」バッジ（ROADMAP へのリンクで、何かの状態を表していない）。「Versions before 0.6.0 kept this in `.ctxjev/`…」。評価の段落にラン番号。

### その他

- **ROADMAP.md**：「Done」の節が Phase 0〜27 の作業日誌。履歴は CHANGELOG と git にあるので、「次にやること」と「設計を決めた制約」だけ残す。
- **CLAUDE.md**：開発者（AI）向けとして正しいが、次の古い・日誌的な文がある。
  - 「the holdout tasks are reserved … until it has run」：holdout は既に実行済み。規則としては「holdout は使用済みで、新しい主張の確認には使えない。調整にも使わない」が正しい（`CONTRIBUTING.md` と同じ）。弱めずに書き直す。
  - 「this project's own history does, from setting up `TYPESAFE_API_KEY` originally」：経緯の話。規則（本物の記録を使わない）は残す。
  - 「all have real, working logic verified against the live Jev API (see ROADMAP …)」：古い状態の説明。
  - 「Claude Haiku used that turn to start editing and committing after a compaction」：規則の理由としては有用なので、一文に縮めて残す。

### 初めての読者が迷うところ

- 「どれを入れればいいか」が分かるまでに時間がかかる（表は 74 行目、使い方は 415 行目）。
- 「score」「keep/summarize/drop」「recency」「Jev」の意味が、例より後に出てくる。
- 既定の動きが入口ごとに違う（CLI とプラグインはオフライン、MCP は `jev`）のに、それが1か所にまとまっていない。

## 3. オーナー向けの記録（docs/audits/ など）の修正

独立監査の報告書（`*-audit-*-ja.md`）は原文のまま保存する決まりなので触りません。私たちが書いた記録だけを直します。

| 文書 | 直すところ | 理由 |
| --- | --- | --- |
| `2026-10-01-round-5-changes-ja.md` | 表の「この PR」の行を、PR [#40](https://github.com/x96x64/ctxjev/pull/40) とマージコミット `16dcda2` に | マージ後なので書ける（空欄のままだった） |
| 同上 | 「#1 と #4 … Round 2 で扱います」を「Round 2 の設計案（`docs/design/round-2-scoring-and-evaluation.md`）で扱う予定」に | 「Round 2」は回の番号ではなく設計案の名前で、今は第6回なので紛らわしい |
| `2026-09-30-round-4-changes-ja.md` | 表の「この PR」の行を、PR #33 とマージコミット `a4ae4b9` に | 同じ理由 |

引用したコミット（`80f524a` など19個）がすべて実在し、件名が記録の説明と合うことも確かめました。

## 4. Codex の調査結果

公式サイト（developers.openai.com）は、この環境のネットワーク制限で開けませんでした。代わりに、OpenAI の公式リポジトリ `openai/codex` のソース（2026-10-01 時点の `main`）を読み、さらに `@openai/codex` の CLI 0.159.3 を実際に入れて試しました（モデルは一度も呼んでいません）。

### 4.1 今動いていること（実機で確認）

- `codex plugin marketplace add <このリポジトリ>` → `codex plugin add ctxjev@ctxjev-plugins` で、プラグインが入り、MCP サーバー `npx ctxjev-mcp@0.7.2` が登録されました。
- このリポジトリの形式（ルートの `plugin.json` と `mcp.json`、Agent Plugins 1.0.0 の書式）は、今の Codex でも正式に読まれます。
- `.agents/plugins/marketplace.json` と `.claude-plugin/marketplace.json` の両方があるとき、Codex は前者を先に使います（ソースの探索順で確認）。Claude Code 用のプラグインを Codex が読み込むことはありません。
- `codex mcp add ctxjev -- npx ctxjev-mcp@<版>` の手順も、今のコマンドの定義と合っています。

### 4.2 見つかった不具合（README の作業より優先します）

- **症状**：Codex は、プラグインの `mcp.json` の `env` に書いた `${TYPESAFE_API_KEY}` を展開しません。展開するのは `${PLUGIN_ROOT}` と `${PLUGIN_DATA}` だけです（ソースの `expand_agent_plugin_placeholders`）。実機の `codex mcp get ctxjev --json` でも、`TYPESAFE_API_KEY` の値は文字列 `${TYPESAFE_API_KEY}` そのものでした。
- **影響**
  1. 本物のキーを設定していても、Codex のプラグイン経由では Jev が使えません（認証エラー）。
  2. キーを設定していない利用者でも、ctxjev-mcp は「キーがある」と誤認します。既定の `scorer: "jev"` の呼び出しで、**マスク済みの目標と抜粋を TypeSafe の API に送ってから** `401 unauthorized` を返します。本来は「キーが未設定」と答えて、何も送らないはずです。ローカルの代役サーバーで再現しました（`Authorization: Bearer ${TYPESAFE_API_KEY}` の要求が1回届いた）。
- **直し方**（小さく安全なので、PR 1 の最初のコミットで実装します）
  1. `plugins/ctxjev/.codex-plugin/plugin.json` を追加し、`env_vars: ["TYPESAFE_API_KEY"]` で親の環境変数をそのまま渡します。これは Codex が用意している正式な仕組みで、実機で `env` から文字列が消え、`env_vars` に入ることを確かめました。版番号の固定（`ctxjev-mcp@<版>`）は `check-versions.mjs` の検査対象に加えます。
  2. 念のための二重の守りとして、`ctxjev-core` に「展開されていない `${NAME}`・`$NAME`・`%NAME%` だけの値はキーとみなさない」関数を置き、MCP・CLI・プラグイン・Jev クライアントのすべてがそれを使うようにします。他のアプリが同じ書き方をしても、何も送られません。
  3. 失敗→合格のテスト（直す前に失敗することを確かめてから直す）と、CHANGELOG の1行を付けます。

### 4.3 Codex での圧縮フックについて（実装しない。正直に書く）

- 今の Codex には `PreCompact`（圧縮の直前）と `SessionStart`（`source: "compact"`、圧縮の直後）のフックがあり、`additionalContext` で文脈に文章を戻せます。フック機能は安定版で既定で有効、プラグインにフックを同梱することもできます（ソースで確認）。
- つまり Claude Code と同じ方式は、原理的には Codex でも作れます。ただし、Codex が渡す会話の記録（`transcript_path` の rollout ファイル）は Claude Code とまったく違う形式です。読み取る部品を `ctxjev-core` に新しく作り、実際の Codex の圧縮で確かめる必要があります。実際の圧縮はモデルを呼ぶので、有料で、今回の範囲外です。
- **結論**：1.0 では、Codex は「MCP の道具として使う」だけを正式な使い方とします。README には、MCP の道具が Codex の文脈そのものを減らさないことも、そのまま書きます。圧縮フックへの対応は、GitHub の issue に「将来の作業」として記録し、確かめていない機能は書きません。

## 5. AGENTS.md と CLAUDE.md

- **確認したこと**
  - Codex は `AGENTS.md` を読みます（公式の仕様）。
  - Claude Code 2.1.286（この環境に入っている版）の内部説明によると、既定では「プロジェクトに `CLAUDE.md` が無ければ `AGENTS.md` を同じように読む」「`CLAUDE.md` が取り込んだファイルは二度読まない」動きです。
- **提案**
  - 中身を `AGENTS.md` に移し、唯一の原本にします。
  - `CLAUDE.md` は `@AGENTS.md`（取り込みの記法）の1行だけにします。古い Claude Code や、設定で `CLAUDE.md` だけを読む場合にも、同じ内容が読まれます。
  - 規則は1つも弱めません。古くなった文（holdout が未実行という前提など）は、今の事実に合わせて書き直します。日誌的な文は外します。
  - `README.md` と `CONTRIBUTING.md` からの案内先も `AGENTS.md` に変えます。

## 6. ルートの README の構成案（英語版）

| 順 | 節 | 中身 | 目安 |
| --- | --- | --- | --- |
| 1 | 名前・一行の説明・バッジ・言語の切り替え | バッジは npm の版（3パッケージ）、CI、ライセンス、Node。切り替えは `en \| ja \| zh \| es \| ko \| pt \| fr \| de`（絶対 URL） | 10行 |
| 2 | 先頭の要点（3行） | 何もしなければ CLI とプラグインは外へ何も送らない。Jev は自分で選んだときだけ。MCP の道具は `scorer` を指定しなければ `jev`。 | 4行 |
| 3 | 30秒の例 | `npm install -g ctxjev-cli` → サンプルをダウンロード → `ctxjev analyze` → 実際の出力（CI が1バイト単位で照合） | 25行 |
| 4 | 特徴 | 5〜6行の箇条書き | 8行 |
| 5 | どれを使うか（入口の表） | CLI、ライブラリ、MCP サーバー、Claude Code プラグイン、Codex。それぞれ「何をするか」「既定で外に送るか」 | 10行 |
| 6 | 導入 | npm の3パッケージ、Claude Code のマーケットプレイス、Codex。必要なもの（Node 20 以上） | 20行 |
| 7 | 使い方（入口ごと） | CLI（`analyze`／`prune` と実際の出力）、ライブラリ（`pruneMessages()` の例）、MCP（設定例は各ホスト1つ）、Claude Code（フックの流れ、`/ctxjev:set-goal`、`/ctxjev:status`）、Codex（MCP として。フックは無いことを明記） | 90行 |
| 8 | 設定の表 | 採点方式（`recency`／`local`／`jev`）の比較、主な既定値（`dropBelow` 0.3 など）、環境変数（`TYPESAFE_API_KEY`、`CTXJEV_SCORER`、`CTXJEV_PRESERVE_LIMIT`、`CTXJEV_STATE_DIR`） | 30行 |
| 9 | 仕組み（短く） | 50件ずつまとめて1回の要求、相対的な新しさ、要求を壊さない削除、Jev に数えさせない | 15行 |
| 10 | プライバシー | 何が、いつ、どこへ送られるか。マスクは最善の努力で、完全ではない。ディスクに書くもの | 15行 |
| 11 | 状態と限界（正直な1段落） | 「未知の課題では、どの採点方式も単純な切り詰め（新しいものから残す）より良いとは示されていない」＋数値は生成された1か所だけ＋`docs/evaluation.md` へのリンク | 8行 |
| 12 | 貢献・セキュリティ・ライセンス | `CONTRIBUTING.md`、`SECURITY.md`、MIT。依存のライセンス表は短く | 20行 |

- **数値の扱い**：README に残す評価の数値は、状態の段落の「holdout の課題数」と「差の点数と区間」だけです。どちらも今と同じ生成ブロック（`<!-- generated:… -->`）で、`check-docs.mjs` が保存結果と照合します。
- **出力例**：今と同じく、実際にコマンドを実行して取った出力だけを載せ、`check-readme-examples.mjs` が CI で1バイト単位で照合します。日付は書きません。Jev の出力例は、確率的で照合できないので「Jev の出力例（実行ごとに変わる）」と明記して `docs/evaluation.md` 側に置くか、外します。

## 7. docs/ に移すもの

| 移す先 | 中身 |
| --- | --- |
| `docs/evaluation.md`（英語、新規） | 今の「Does It Work?」の全部（生成された表と文、読み方の注意）、マスクのブラインドコーパスの結果（生成）、holdout が使用済みであること、Part E で書く評価データの既知の欠陥 |
| `docs/design-notes.md`（英語、新規） | 今の「Design Notes」の詳しい版（`recencyWeight` の決め方など） |
| `docs/development.md`（英語、新規） | `.mcp.json` の注意、Node 22 が要る評価スクリプト、本物の記録を使わない規則への案内（中身は `AGENTS.md` と `CONTRIBUTING.md`） |
| `ROADMAP.md` | 「Done」の日誌を外し、「Next」と「Constraints」だけに |

- **検査は弱めません**：`check-docs.mjs` の対象に `docs/evaluation.md` を「結果の節」として加え（表と文の数値をすべて照合）、README の状態の段落は今と同じ `checked-prose` で囲みます。`--selftest` が使う「監査の改ざん例」は、移した先の文書に向け直し、全件が今も検出されることを示します。

## 8. パッケージの README の作り方（Part C）

- **共通の部分は1か所に**：`docs/readme-shared/` に「何か」「プライバシー」「状態と限界」「ライセンス」の英語の断片を置きます。各パッケージの README には `<!-- shared:privacy -->…<!-- /shared:privacy -->` のような目印を置き、スクリプト（`scripts/readmes.mjs`）が中身を埋めます。CI は「埋めた結果が保存された README と同じか」を検査するので、手で同期する必要はありません。パッケージごとの使い方は手で書きます。
- **npm 用の書き換え**：`npm pack`／`pnpm pack` の直前（`prepack`）に同じスクリプトが走り、相対リンクと画像のパスを `https://github.com/x96x64/ctxjev/blob/v<版>/…` の絶対 URL（リリースのタグに固定）に書き換えます。pack の直後（`postpack`）に元に戻します。
- **CI の検査**
  1. pack した各パッケージの README に相対リンクが残っていない。
  2. すべてのリンクが、リポジトリの中に実在するファイル（と見出し）を指している。
  3. 例の出力が実際の出力と一致する（今の `check-readme-examples.mjs` をパッケージの README にも広げる）。
- **確かめ方**：3パッケージを `npm pack` し、空のフォルダに入れて、tarball の中の README を取り出して中身を確認します。

## 9. 翻訳の計画（Part D）

- 英語の `README.md` が正本です。翻訳はルートの README だけで、`README.ja.md`、`README.zh.md`（簡体字）、`README.es.md`、`README.ko.md`、`README.pt.md`（ブラジルのポルトガル語）、`README.fr.md`、`README.de.md` を作ります。どの変種かは各ファイルの中の注記に書き、ファイル名には入れません。
- コマンド、コード、フラグ、パッケージ名、「Jev」は訳しません。各翻訳の先頭に言語の切り替え行と「英語版から翻訳したもので、英語版が正本です」という注記（その言語で）を置きます。
- **CI の検査**（`scripts/check-translations.mjs`）
  - コードブロック、生成ブロック（数値）が英語版と1バイトも違わなければ合格、違えば失敗。
  - 各翻訳には、元にした英語版のハッシュ（内容の指紋）を記録します。英語版がその後変わっていれば、失敗ではなく警告を出します。
- **見直し**：言語のグループごとに1つの別エージェントに、自然さと技術的な意味の誤りを見てもらいます（東アジア：ja・zh・ko、ロマンス語：es・pt・fr、ドイツ語：de）。自信の無い言語は PR の説明に書きます。

## 10. 1.0 の試験版（rc）について（Part E の先取り）

今の公開ワークフローで `1.0.0-rc.1` を出すには、次の変更が必要で、安全とは言えないため、rc は見送る予定です。

- npm 12 は、試験版の番号を `--tag` 無しで公開するのを拒否します。ワークフローに分岐を足す必要があります。
- `gh release create` は、何も指定しないと rc を GitHub の「Latest」にしてしまいます。
- 版番号をそろえる決まりにより、rc の間は `main` の MCP の設定例が `ctxjev-mcp@1.0.0-rc.1` を指し、マーケットプレイスも rc のタグからプラグインを配ります。つまり、npm の `latest` は変わらなくても、Claude Code と Codex の利用者には rc が届いてしまいます。

代わりに、監査の対象は「1.0.0 の候補となるコミット」とし、そのコミットで3パッケージを pack して空のフォルダに入れる確認（前回までのリリースと同じ手順）をします。

## 11. PR の分け方

1. README の作り直し、`docs/` への移動、`AGENTS.md`、Codex の修正（4.2）と説明
2. npm ページ用の生成と CI の検査
3. 翻訳7言語
4. 1.0 の準備（公開 API の文書、既定値の判断、既知の制限、issue の整理）
