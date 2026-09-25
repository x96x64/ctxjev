# 2回目の独立監査の仕分け（2026-09-25、ラウンド1.5）

2回目の独立監査（[`2026-09-25-audit-2-ja.md`](2026-09-25-audit-2-ja.md)、62/100）は、ラウンド1がマージされる前のコミット `2cf4eba` を対象にしています。この文書は、その指摘を**現在の作業内容（ラウンド1.5のブランチ、`main` の `0e19b39` から開始）**と一つずつ突き合わせた結果です。あわせて、消されたブランチからタグとして保存されていた作業（アーカイブ）の中身を、最初（第1節）にまとめます。

- 分類の意味：**修正済み**＝直したことをコミットかテストで示せる。**未修正**＝今も再現する（再現のコマンドと出力を記載）。**再現せず**＝指摘どおりには再現しない。
- 「ラウンド1」は PR #1（`b510dba` でマージ）、「1.5」はこのラウンドのコミットです。コミットは短いハッシュで示します。
- 評価の数値は手で書かず、`packages/core/eval/check-docs.mjs` が保存済みの結果ファイルから生成します（`<!-- generated:… -->` の部分）。アーカイブの文章からの引用は「引用」と明記しています。

## 用語メモ（初出のみ）

- **アーカイブのタグ**：ブランチを消す前に、その最後のコミットに付けた名札。中身は失われず、`git show <コミット>` で読めます。
- **ホールドアウト**：設計に使わず、最終判定のためだけに取っておく評価データ。
- **事前登録**：結果を見る前に「何をどう測り、どう判断するか」を文書で固定すること。
- **ダイジェスト**：Claude Code のプラグインが、会話の圧縮（要約）の後に再注入する「重要な抜粋」。
- **95%CI（信頼区間）**：データのぶれを考えると本当の差がおそらく入る範囲。下限が 0 より上なら「差がある」と言える。

## 1. アーカイブから復元した作業（手順 0.5）

2026-09-24 に、`2cf4eba` から始めた2つのセッションの作業が、マージされないまま2つのタグに保存されていました。**全6コミット**を `git show` で読み、次のように扱いました。アーカイブのコミットを丸ごと取り込むこと（マージやチェリーピック）はしていません。持ち込んだものは、別のコミットで、元のタグと SHA を明記しています。

### 1.1 各コミットの要約

| コミット（タグ） | 何をしたか（やさしい言い方で） | 扱い |
| --- | --- | --- |
| `d8aa0b1`（`archive/claude/plugin-holdout`） | プラグインのホールドアウト比較（事前登録した比較のうちプラグインの部分）を、フックが Jev に届く環境で最後まで実行し、結果ファイルを保存。事前登録文書に結果を追記（README は変更せず） | 結果ファイルを**中身を変えずに**復元（`5811861`）。数値は生成で文書に反映（`ac07729`） |
| `042cf4c`（`archive/main-rggfgw`） | 同じ比較を別のセッションでもう1回実行し、結果を保存。README・プラグイン README・ROADMAP・CHANGELOG を「効果は示せず」に更新 | 結果ファイルを中身を変えずに復元（`5811861`）。README 等の文章は、数値を手で書いていたうえ自分の実行だけを載せていたため移植せず、両方の実行を生成で載せ直した（`ac07729`）。ROADMAP の「再実行する」の削除だけ反映（`546e9dc`） |
| `fa22e81`（同） | ①プラグインの既定を「ローカル採点（何も送らない）」にし、Jev は `CTXJEV_SCORER=jev` で選ぶ方式に変更。②評価のための100点満点の採点基準 `RUBRIC.md` を新設。③ホールドアウトの保持率の再実行を `run-holdout.json` として保存し、README の表をそのファイルに合わせた | ①は意図して移植（`522a9d5`、理由は 1.4）。②は移植しない（1.5）。③は結果ファイルを中身を変えずに復元（`5811861`）。README の表はラウンド1の生成表で置き換え済みのため移植せず。「実物のセッション記録に使うときは `--scorer jev` のときだけ注意」という README の直しは、まだ直っていなかったので反映（`546e9dc`） |
| `f0b72e7`（同） | ラウンド2の別案を事前登録：履歴を約8万トークンに水増しする `lengthen.mjs`、本物の Claude Code の圧縮を使う `plugin.mjs --compaction real`、ダイジェストの網羅率を測る `digest-coverage.mjs`、`transcript.mjs`、予算 $10 | 採用しない。有用な考えを設計文書 3.10 節に「選択肢」として取り込んだ（1.6） |
| `705839a`（同） | 上の別案の本番コマンドを1回始めたが、最初の課題の圧縮中に、利用者の依頼で費用を確認するため手で止めた、という記録 | 止めた経緯とその下で集めたデータを 1.6 で開示 |
| `ac67ad5`（同） | dev の保持率の再実行を `run-dev.json` として保存し、README の dev の保持率の数値をそのファイルに合わせ、回答正答率の区間の上限の小さな誤りを直した | 結果ファイルを中身を変えずに復元（`5811861`）。README の2点は、ラウンド1で生成に置き換え済みのため不要（現在の README は保存データから生成した値を表示） |

### 1.2 復元した結果ファイル

中身を1バイトも変えずに `packages/core/eval/results/` に置きました（git のブロブのハッシュが元と一致することを確認）。名前だけ、同じ名前だった2つのプラグインの結果を並べて置けるように変えています。由来の一覧は [`results/README.md`](../../packages/core/eval/results/README.md) にあります。

| ファイル | 元のコミット | 内容 |
| --- | --- | --- |
| `plugin-holdout-d8aa0b1.json` | `d8aa0b1` | プラグインのホールドアウト比較（1回目） |
| `plugin-holdout-042cf4c.json` | `042cf4c` | プラグインのホールドアウト比較（2回目） |
| `run-holdout-fa22e81.json` | `fa22e81` | ホールドアウトの保持率の再実行 |
| `run-dev-ac67ad5.json` | `ac67ad5` | dev の保持率の再実行 |

### 1.3 プラグインのホールドアウト比較：2回とも「効果は示せず」

`main` は「この比較は結果が出なかった」と書いていましたが、実際には 2026-09-24 に**2回、最後まで実行されていました**。2つの結果は食い違うので、**両方を載せます**。どちらかを選ぶことはしません。

<!-- generated:design-plugin-holdout -->
| 模擬の圧縮後（ホールドアウト、Claude Haiku 4.5） | 実行 `d8aa0b1`：課題成功 | 回答正答 | 実行 `042cf4c`：課題成功 | 回答正答 |
| --- | --- | --- | --- | --- |
| 要約のみ | 100% | 78% | 100% | 79% |
| 要約＋ダイジェスト（プラグインが推定した目標） | 94% | 88% | 83% | 82% |
| 要約＋ダイジェスト（同じ目標を `/ctxjev:set-goal` で指定） | 100% | 88% | 89% | 85% |
| 差：ダイジェスト（推定）− 要約のみ［95%CI］ | −6 [−17, 0] | +10 [+5, +14] | −17 [−39, 0] | +3 [−3, +9] |
| 差：ダイジェスト（指定）− 要約のみ［95%CI］ | 0 [0, 0] | +10 [+1, +16] | −11 [−22, 0] | +6 [−1, +15] |

実行 `d8aa0b1`：6 課題 × 3 回、フックが Jev で採点した回数 18／18。実行 `042cf4c`：6 課題 × 3 回、フックが Jev で採点した回数 18／18。2つのダイジェスト条件は、両実行とも全回で同じ目標で採点されていました（18／18、18／18）。つまり「目標の渡し方が違うだけの同じ設定」を2回ずつ測ったものです。
<!-- /generated:design-plugin-holdout -->

- **事前登録に従っていたか**：2回とも、事前登録文書の手順4にある同じコマンド（`plugin.mjs --split holdout --runs 3 --max-usd 5`）を、同じコード（`2cf4eba`。登録後の変更として記録済みのプロキシ設定と締め切り 20 秒を含む）で実行しており、手順どおりです。ただし計画は「1回実行する」前提で、2回実行されたときにどちらを採るかは決めていませんでした。2つのセッションはほぼ同時刻（コミットの時刻差は2秒）に別々に実行しており、互いの結果を見て選んだものではありません。そのため両方を「登録どおりの実行」として扱い、判断ルールを両方に当てはめました。
- **判断ルールの結果**：事前登録のルール（課題成功の差の 95%CI の下限が 0 より上なら効果あり）は、**2回とも、2つのダイジェスト条件のどちらでも満たしません**。結論は「未知の課題でのプラグインの効果は示せていない」です。回答正答率はルールの判断指標ではなく、2回で結果も食い違うため、判断には使いません。
- **費用**（コミットメッセージからの引用。結果ファイルにはエージェント実行の費用しか残っていない）：`d8aa0b1` は「$4.23 spend」、`042cf4c` は「Spend: $4.10」。どちらも上限 $5 の範囲内。
- **表の読み方の注意**：2つのダイジェスト条件は、全実行で同じ目標を使っていました（表の下の説明）。0.5.0 以降のプラグインは、評価スクリプトが「指定した目標」として渡すのと同じ目標を自分で推定するためで、実質「同じ設定を2回ずつ」測っています。
- 同じ日の保持率の再実行（`run-holdout-fa22e81.json`、`run-dev-ac67ad5.json`）：<!-- generated:design-recovered-retention -->ホールドアウト（v1、25% 予算）で Jev 21.6%、ランダム順 26.5%、キーワード一致 28.3%、切り捨て 0.0%（Jev − 切り捨て +21.6 [+5.7, +41.7]）。dev の Jev は 86.0%／95.6%（25%／50% 予算）<!-- /generated:design-recovered-retention -->。ラウンド1の保存済み再実行と同じく、ホールドアウトでは Jev がランダム順とキーワード一致を下回っています。

### 1.4 プラグインの既定を「ローカル採点・外部送信なし」にした理由（移植、`522a9d5`）

- **証拠と一致する**：ホールドアウトの保持率で Jev はキーワード一致（ローカル採点）とランダム順を下回り、Jev で採点したダイジェストは2回の比較のどちらでも効果を示せませんでした。効果が示せないものに、利用者の会話を外部へ送る理由はありません。
- **決定 Q1 と一致する**：「Jev は任意の信号として、あり・なしを比べる」。既定をローカルにし、Jev は `CTXJEV_SCORER=jev` で選ぶ形はこれに沿います。
- **正直さ**：ローカル採点のダイジェストが役立つことも示されていません。README とプラグイン README には「どちらの採点方式も効果は示せていない」と明記しました。
- **テスト**：鍵を設定しても `CTXJEV_SCORER=jev` がなければ、偽の Jev サーバーに1件も要求が届かないことを確かめるテストを追加しました（アーカイブ版は注記の有無しか見ていなかった）。新しいテストは変更前の配布物（dist）では失敗し、変更後は合格します。全テスト合格、dist は再ビルドしてコミット、CHANGELOG に記載。
- 評価スクリプト `plugin.mjs` は `CTXJEV_SCORER=jev` を明示して、保存済みの結果と同じ Jev 採点のダイジェストを測り続けます。

### 1.5 `RUBRIC.md`：何か、何が使っていたか、なぜ移植しないか

- **何か**：`fa22e81` で作られた100点満点の採点基準です。「A 利用者への効果の実証 35点、B 主張と証拠の一致 20点、C 費用とリスクの釣り合い 15点、D 実装の品質 15点、E 評価の作法 15点」。本文には、それ以前の点数が「84、92、30」と基準なしに揺れたので固定した、と書かれています（引用：*"Earlier scores (84, then 92, then 30) were given on different, unstated axes"*）。
- **何が使っていたか**：同じ日の別案の事前登録（`f0b72e7`）だけが「RUBRIC.md の基準 A で採点する」と参照していました。コードやテスト、CI は使っていません。
- **復元した結果は依存していない**：2つのプラグインの結果は `RUBRIC.md` より前にコミットされ、保持率の2つの再実行もこの基準とは無関係です。
- **判断**：移植しません。このプロジェクトの目標は監査の採点基準（100点満点で95点）で、別の基準を並べると混乱を招きます。本文はタグに残っています（`git show fa22e81:packages/core/eval/RUBRIC.md`）。

### 1.6 止めた別案の事前登録（`f0b72e7`・`705839a`）：中身、止めた理由、集めたデータ

- **中身**：全16課題（dev と旧ホールドアウトの両方）の記録を約8万トークンに水増しし、本物の Claude Code の `/compact` で圧縮し、「要約のみ」「要約＋ダイジェスト（ローカル）」「要約＋ダイジェスト（Jev）」を比べる。主指標は回答正答率。Anthropic API の予算は $10。
- **採用しない理由**：すでに設計に使った、または結果を見た材料（dev と旧ホールドアウト）で評価しており、何かを確認する証拠になりません（本人も文中で *"None of this material is unseen."* と認めています）。一方、「長い履歴」と「本物の圧縮」は、現在の計画の弱点（要約がほぼ全部を残せるので差が出ない）を突く良い考えなので、設計文書 3.10 節に 2a で採否を決める選択肢として取り込みました。
- **止めた理由**（`705839a` の記録からの引用）：*"the command above was started once and stopped by hand within the first task's compaction, at the user's request to review the spend before continuing; it produced no results and nothing from it was seen."*（本番コマンドを1回始め、最初の課題の圧縮中に、費用を確認したいという利用者の依頼で手で止めた。結果は出ておらず、何も見ていない。）同じ記録は「同じコマンドで再開した」と続けていますが、アーカイブにはその再開の結果は残っていません。
- **その下で集めたデータ（開示）**：結果ファイルは保存されておらず、以下はアーカイブの文章からの引用です（検証できません）。
  - 実現性の確認（ヘッドレスの `/compact`）：*"a $0.015 feasibility check"*。
  - dev の1課題（`invoice-rounding`）での試運転：*"A smoke run on one dev task (invoice-rounding, one run) checked the harness and its cost ($0.25). It is excluded from the results; it showed +17 points on answers right for the local digest on that one task and run, which is not evidence of anything."*
  - オフライン（API なし）の dev でのダイジェスト網羅率の比較：*"probes no user message states went from 28/35 to 29/35 covered by the digest, while all probes went from 47/57 to 42/57"*。この変更は採用されていません。
  - 途中で止めた本番：*"Cost: at most about $0.10, so at most about $0.37 spent"*。
  - どれも dev または見たことのある材料で、ラウンド1.5の設計判断には使っていません。

### 1.7 README の直し

ラウンド1がすでに置き換えていたもの（保持率の表、dev の数値、区間の上限）は移植せず、置き換えられていなかった1点（実物のセッション記録を分析するときの注意は `--scorer jev` のときだけ）と ROADMAP の1点を反映しました（`546e9dc`）。

## 2. 監査レポート第4節の指摘

### 4.1 中核機能と正しさ

| # | 指摘（要約） | 分類 | 根拠 |
| --- | --- | --- | --- |
| 4.1-1 | README の出力例が既定（recency）では再現しない | 修正済み | ラウンド1 `b2ad630` で実際の出力に差し替え。現在のビルドで `ctxjev analyze examples/sample-transcripts/checkout-bug.json` を実行し、README の7行と一字一句一致することを確認 |
| 4.1-2 | `ctxjev analyze --version` が失敗する | 修正済み | ラウンド1 `15727d2`。テスト「ctxjev flags > prints the version before or after the command」。現在 `ctxjev analyze --version` は `0.6.0` を表示 |
| 4.1-3 | `--scorer local` を既定の閾値で使うと関連する項目の大半を削除する | 修正済み | 1.5 `8e17b6b`：`pruneContext()` が一致度をバッチ内の順位に変換してから閾値を適用。較正は dev のみ：<!-- generated:local-calibration -->dev のみ（20 件の会話、既定の閾値、会話ごとの平均）：従来（生の一致度）関連項目の削除 73.5%・全項目の削除 82.7%、同点を最小順位 関連項目の削除 34.2%・全項目の削除 45.7%、同点を平均順位 関連項目の削除 20.0%・全項目の削除 28.1%。事前に決めた規則で「平均順位」を採用<!-- /generated:local-calibration -->。テスト `prune.test.ts`（監査の3サンプルで関連項目の過半を失わない等。変更前のコードでは5件とも失敗） |
| 4.1-4 | 節約量がマイナスでも変更を適用する | 修正済み | ラウンド1 `7da04b0`（テスト「pruneMessages > never makes a conversation larger」ほか、性質テストに「節約量は負にならない」）。表示側も 1.5 `09d4f44` で、節約がないときは「no tokens saved」と表示 |
| 4.1-5 | 「最新ターンは触らない」は実際には最後の2メッセージだけ | 修正済み | 1.5 `1682fe4`：`protectLastTurn`（既定オン）。変更前に監査と同じ形（最後の指示の後にツール3往復）で `tool:m1`・`tool:m2` が消えることを再現。テスト「protectLastTurn > never touches the last user instruction or any tool round-trip after it」ほか4件、性質テストにも追加 |
| 4.1-6 | 1行の重複で解析全体が失敗 | 修正済み | ラウンド1 `59af6a3`。テスト「parseClaudeCodeTranscript > keeps the last of records that repeat a uuid, and says so」 |
| 4.1-7 | `--protect-last` が独自形式で黙って無視される | 修正済み | 1.5 `09d4f44`。変更前：`ctxjev prune checkout-bug.json --protect-last 5` が終了コード 0。変更後：`✖ --protect-last only applies to an Anthropic Messages transcript`（終了コード 1）。テスト「rejects --protect-last and --no-protect-last-turn on a ctxjev-format transcript」 |

### 4.2 有効性

| # | 指摘（要約） | 分類 | 根拠 |
| --- | --- | --- | --- |
| 4.2-1 | 主要評価（課題成功）は原理的に差が出ない設計 | 未修正（ラウンド2で対応） | 保存済みの結果は今も全条件で合格：<!-- generated:ja-holdout-primary -->Haiku 0 [0, 0]、Sonnet 0 [0, 0]（Jev − 切り捨て、課題成功、ポイント）<!-- /generated:ja-holdout-primary -->。再現：`node eval/tasks.mjs --report eval/results/tasks-holdout.json`（付録 A-1）。新しい課題は必要な事実をツール出力にだけ置く（設計文書 3.1 節、仕様書 `AUTHORING.md`） |
| 4.2-2 | ホールドアウトの保持率で Jev はランダム順に負け、README に載っていない | 修正済み（開示） | ラウンド1 `b81bc76` で README の冒頭と「Does It Work?」に明記（生成）。効果そのものは変わらない（事実） |
| 4.2-3 | 切り詰めの 0% は、ラベル付け手順の違いによる見かけの結果 | 修正済み（開示と指標） | ラウンド1で探索的指標として追加し、1.5 `2783a65` で「v2（修正依頼まで）」として正式な名前を付け、ラウンド2の事前登録の指標にする（v1 は再現性のため不変） |
| 4.2-4 | dev での優位も弱い | 未修正（事実。開示済み） | README と設計文書に区間ごと掲載（生成）。新しい評価で判断する |
| 4.2-5 | 既定の recency は単純な切り詰めで、凡例は「高いほど関連」 | 凡例は修正済み、価値の問題は未修正 | 凡例：1.5 `09d4f44`（recency では「位置であって関連度ではない」と表示。テスト「says what the score means for each scorer」）。製品としての独自価値はラウンド2（Q1）で扱う |

### 4.3 評価の厳密さと主張の誠実さ

| # | 指摘（要約） | 分類 | 根拠 |
| --- | --- | --- | --- |
| 4.3-1 | 検出力ゼロの主要評価で既定を決めた | 未修正（ラウンド2） | 4.2-1 と同じ。ラウンド2で予算を厳しく（10/15/25%）、課題を24に、検出できる差の目安を事前登録で明記（設計文書 3.7 節） |
| 4.3-2 | 副次評価の歪み、ホールドアウトと dev のタスク規模の違い | 一部修正 | 歪み：v2 指標（`2783a65`）。規模：未修正（新しい課題で揃える。設計文書 補足A） |
| 4.3-3 | README の副次評価の数値が記録と不一致、保存もされていない | 修正済み | ラウンド1 `630072e`（保存）・`b81bc76`（生成）。1.5 で同じ日の再実行2件も復元（1.2） |
| 4.3-4 | ランダム比較を省いている | 修正済み | ラウンド1 `b81bc76` |
| 4.3-5 | ラベル付けは AI 1名、正誤判定の人による確認なし | 一部修正 | 人の確認：確認用ページと κ の計算を実装（1.5 `23e1b1e`、Q4 で保守者が実施）。課題作成者の分離：仕様書を用意（`eed1bb7`、Q3）。ラベル付けの複数化は未修正 |
| 4.3-6a | 履歴コミットが空で、プローブの「このコミットで入った」と矛盾 | 新しい課題は修正済み、既存データは未修正（記録） | 修正：1.5 `eed1bb7`（形式2、`harness-selftest.mjs`）。再現（既存）：付録 A-3 |
| 4.3-6b | `room-booking` のログと雛形の動作が矛盾 | 未修正（既存データは書き換えない。記録） | 付録 A-2。仕様書に「ログは雛形の動作と一致させる」を追加 |
| 4.3-6c | 日本語ホールドアウト2件のプローブが英語 | 新しい課題は修正済み、既存データは未修正（記録） | 修正：`eed1bb7`（`probes.mjs`、`label-session.mjs`、`check-sessions.mjs`）。再現：付録 A-4 |
| 4.3-6d | 隠しテストの「変更禁止」を `git diff HEAD` で見ており、コミットで回避できる | 新しい課題は修正済み、既存課題は未修正（記録） | 修正：`eed1bb7`（元のリポジトリとの比較、`verify.mjs` が形式2での `git diff` を拒否。`harness-selftest.mjs` が「コミットで回避すると元のリポジトリとの比較では失敗し、`git diff HEAD` はだまされる」ことを確認）。再現：付録 A-5 |
| 4.3-7 | トークン数は `gpt-tokenizer` による近似 | 未修正（既知の限界、開示済み） | `packages/core/src/tokenEstimate.ts:1`。README「What this doesn't show」に明記 |

### 4.4 コード品質と設計

| # | 指摘（要約） | 分類 | 根拠 |
| --- | --- | --- | --- |
| 4.4-1 | テストファイルが型チェックの対象外 | 修正済み | ラウンド1 `041fa38`（`pnpm typecheck`、CI） |
| 4.4-2 | CLI のスコアキャッシュが無制限・生の本文をキーに | 修正済み | ラウンド1 `739c63a`（SHA-256 のキー、上限 20,000 件、0600）。テスト「loadFileScoreCache > keeps the file readable only by the user…」ほか |
| 4.4-3 | 「50件でも1件とほぼ同じ費用」は誤り | 修正済み | ラウンド1 `b2ad630` |
| 4.4-4 | `UserPromptSubmit` のフックがすべての入力で Node を起動 | 未修正 | 再現：普通の入力で `statusHook.js` を10回起動し平均 72.2 ミリ秒（付録 A-6）。解決案：Claude Code 2.1.282 にある `UserPromptExpansion` フック（`command_name` で絞り込める）を使う。古い版と Windows での挙動を本物の Claude Code で確かめてから切り替える（設計文書 第2節末） |
| 4.4-5a | 古いコメント（`esbuild.build.mjs:7`、`eval/plugin.mjs:14-16`） | 修正済み | 1.5 `aa33096` |
| 4.4-5b | 名前と中身が逆のテスト（`cache.test.ts:19`） | 修正済み | 1.5 `aa33096`（名前を中身に合わせた。検査内容は不変） |
| 4.4-5c | 未知の `scorer` が黙って recency 扱い | 修正済み | ラウンド1 `a4b1a2a`。テスト「scoreEntries > rejects a scorer name it does not know…」 |
| 4.4-5d | 完了していないツール呼び出しが末尾に追加され、recency で最新扱い | 修正済み | 1.5 `b108f81`。変更前：順序 `u1, a2:text:0, u2, orphan`、recency の点数 1。変更後：`u1, orphan, a2:text:0, u2`。テスト「keeps unfinished tool calls where they were made, in order, not after later entries」 |

### 4.5 テスト

| # | 指摘（要約） | 分類 | 根拠 |
| --- | --- | --- | --- |
| 4.5-1 | Jev 通信部分と MCP の配線がオフラインで未検証 | 修正済み | ラウンド1 `90296a9`・`6b0432a`（「scoreRelevance with an injected client (offline)」、キー無しの `listTools`） |
| 4.5-2 | マスクのテストが少ない | 修正済み | ラウンド1 `c8cd4ee`（40形式）、1.5 `02ebdcb` で 51 形式・無害な例 27 件に拡張 |
| 4.5-3 | 監査で見つけた問題が未テスト | 修正済み | 各修正コミットに回帰テスト（本表の各行） |
| 4.5-4 | 「ネットワーク不要」の既定テストが外部へ送信を試みる | 修正済み | ラウンド1 `198e626`（閉じたローカルポート、許可リストの環境変数） |
| 4.5-5 | テストの型エラーを検出できない | 修正済み | 4.4-1 と同じ |

### 4.6 セキュリティとプライバシー

| # | 指摘（要約） | 分類 | 根拠 |
| --- | --- | --- | --- |
| 4.6-1 | マスクの網羅性（JSON、URL、短いパスワード、PGP、Stripe、カード番号など） | 修正済み | ラウンド1 `c8cd4ee`。1.5 `02ebdcb` で残っていた PGP 秘密鍵ブロックとカード番号を追加（変更前に再現：どちらもそのまま残った）。表形式のテストは監査2の挙げた全形式を含む 51 形式。`scripts/redact-coverage.ts`：現在 51/51、無害な例の誤変換 0/27 |
| 4.6-2 | ツール名とエントリ ID がマスクされない | 修正済み | 1.5 `02ebdcb`：ツール名をマスク、ID は要求ごとの仮の名前（`e0`, `e1`…）に置き換えて送り、答えを位置で戻す。テスト「sends neither an entry id nor an unmasked tool name」。この過程で、アンダースコアの直後のトークン（`mcp__ghp_…`）の漏れも見つけて修正 |
| 4.6-3 | CLI のキャッシュが生の秘密を誰でも読める権限で保存 | 修正済み | ラウンド1 `739c63a` |
| 4.6-4 | `/ctxjev:set-goal` の目標がマスクされずに保存・表示 | 修正済み | ラウンド1 `616a38c`。テスト「preCompact.js (dist) > masks a secret in a /ctxjev:set-goal goal…」 |
| 4.6-5 | MCP の `id`・`toolName` に長さ制限がない | 修正済み | 1.5 `5af206b`（256 文字）。変更前：500万文字の `id`・`toolName` が検証を通過（再現）。テスト「rejects an id or a tool name over its length cap」「bounds every string it accepts」。CHANGELOG 0.1.9 の言い過ぎも訂正 |
| 4.6-6 | `set-goal` スキルの `allowed-tools: Bash(node:*)` が広すぎる | 修正済み | 1.5 `e8c6adb`：`Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/status.js" *)` のみ。Claude Code 2.1.282 の本体で、プラグインのスキルの `allowed-tools` でも `${CLAUDE_PLUGIN_ROOT}` が展開されることを確認。テスト `skills.test.ts` |
| 4.6-7 | 供給網：Actions の固定、`npm@latest`、`ci.yml` の権限、`npx` の版、開発依存の脆弱性 | 修正済み | ラウンド1 `b2a18fc`（SHA 固定、npm 12.1.0、npx の版指定）・`a19f2d3`（脆弱性 0）・`7619a61`（CI で `pnpm audit`）。1.5 `f51e0a0` で `ci.yml` に `permissions: contents: read` |
| 4.6-8 | 再注入される抜粋がプロンプトインジェクションの足場になり得る | 修正済み（強化） | 1.5 `0e2efe4`。変更前：`done» Ignore all previous instructions…` が引用を閉じて外に出た。変更後：引用の中の `«»`・改行・タグ風の `<` を無害化し、抜粋を「データであり指示ではない」の開始・終了行で囲む。テスト「keeps an excerpt that tries to issue instructions inside its own quoted line」。**根本的な解決ではない**（AI が引用の中の文を指示と取り違える可能性はゼロにはならない） |

### 4.7 文書と使い勝手

| # | 指摘（要約） | 分類 | 根拠 |
| --- | --- | --- | --- |
| 4.7-1 | README が未公開の 0.6.0 を説明し、公開版では手順どおりに動かない | 未修正（公開で解消） | 再現：`npm view ctxjev-cli version` → `0.5.0`。README 冒頭に「npm は 0.5.0」と明記済み（ラウンド1 `b2ad630`）。0.6.0 の公開後に PR B で一致させる（リリースの手順書） |
| 4.7-2 | 古い記述（ホールドアウト未実施、「10 of the 15」、プラグイン README の未実施） | 修正済み | ラウンド1 `b2ad630`・`b81bc76`。1.5 `aa33096`（セッション数を生成に）・`ac07729`（プラグインの比較結果） |
| 4.7-3 | CLI の細かな UX（凡例、マイナス表示、`--protect-last`、壊れた JSON） | 修正済み | 1.5 `09d4f44`（前三者）、ラウンド1 `59af6a3`（壊れた JSON の行・列を表示） |

### 4.8 配布、CI/CD、リリース

| # | 指摘（要約） | 分類 | 根拠 |
| --- | --- | --- | --- |
| 4.8-1 | プラグインは未リリースの `main` を配布 | 未修正（準備済み、公開で解消） | 再現：`main` の `.claude-plugin/marketplace.json` は `"source": "./packages/claude-plugin"`。準備：1.5 `f0db92d`（タグ固定の検査と書き換え）。切り替えは PR B（`--update-pins`）。Claude Code 2.1.282 で、同じ形で既存タグ `v0.5.0` から実際にインストールできることを確認 |
| 4.8-2 | SHA 固定・依存の自動更新・CI での監査がない | 修正済み | ラウンド1 `b2a18fc`・`7619a61`、Dependabot 設定 |
| 4.8-3 | CI で未確認：テストの型チェック、カバレッジ、`verify.mjs` | 一部修正 | 型チェック・`verify.mjs`：ラウンド1 `041fa38`・`f7fd254`。1.5 で `harness-selftest.mjs`・`check-sessions.mjs`・隔離の自己検査も CI に追加。カバレッジ（テストが通ったコードの割合）の計測は未修正（CI の設定に含まれない。付録 A-7） |
| 4.8-4 | 短期間に多数の公開、0.1.x〜0.2.0 にタグなし、任意のブランチから公開できる | 一部修正 | 任意のブランチ：1.5 `f51e0a0`（`main` 以外では公開ジョブが動かない）。公開の頻度：ラウンド1で方針を `CONTRIBUTING.md` に明文化。古い版のタグ：未修正（過去の履歴。付録 A-7） |

### 4.9 保守性

| # | 指摘（要約） | 分類 | 根拠 |
| --- | --- | --- | --- |
| 4.9-1 | CONTRIBUTING・SECURITY・Issue テンプレートがない | 修正済み | ラウンド1 `2c04d4f`（CONTRIBUTING、SECURITY）、1.5 `fa4feae`（Issue テンプレート） |
| 4.9-2 | 作者1名・歴史4日・AI との共同作成が大半 | 未修正（コードでは解決できない） | — |
| 4.9-3 | 開発用の依存が古い・脆弱性 | 修正済み | ラウンド1 `a19f2d3`（vitest 4、esbuild 0.28）、PR #5・#7（ESLint 10、TypeScript 6）。TypeScript 7 と `@types/node` 23 以降は理由付きで見送り（issue #4） |

## 3. 監査レポート第6節（重大な問題トップ5）

| # | 問題 | 分類 | 根拠 |
| --- | --- | --- | --- |
| 1 | 秘密情報のマスクの穴、ツール名・ID、プラグインが既定で Jev に送る | 修正済み | 4.6-1・4.6-2。プラグインは 1.5 `522a9d5` から既定で何も送らない |
| 2 | CLI のキャッシュが生の本文を誰でも読める権限で保存 | 修正済み | 4.6-3 |
| 3 | 有効性の主張に根拠がなく、評価の読み方に歪み | 開示は修正済み、効果の証拠は未修正 | 4.2・4.3。効果はラウンド2の新しい事前登録の評価で判断する |
| 4 | README が未公開の 0.6.0 を説明 | 未修正（公開で解消） | 4.7-1 |
| 5 | `local` を既定の閾値で使うと関連項目の大半を削除 | 修正済み | 4.1-3 |

## 4. 監査レポート第7節（改善案 1〜14）

| 改善 | 内容 | 分類 | 根拠 |
| --- | --- | --- | --- |
| 1 | README と公開版の食い違い | 未修正（公開で解消） | 4.7-1、PR B、リリースの手順書 |
| 2 | マスクの網羅性、ツール名、ID の置き換え | 修正済み | 4.6-1・4.6-2 |
| 3 | CLI キャッシュ | 修正済み | 4.6-3 |
| 4 | 評価結果の記述 | 修正済み | 4.3-3・4.3-4・4.2-2 |
| 5 | `local` の尺度 | 修正済み | 4.1-3 |
| 6 | 節約量の判定と最新ターンの保護 | 修正済み | 4.1-4・4.1-5 |
| 7 | ホールドアウト評価の第2版（a〜g） | 一部修正 | (a) v2 指標：`2783a65`。(f) 元のリポジトリとの比較：`eed1bb7`。(b)(c)(d)(e)(g) はラウンド2の計画（設計文書 第3節・第6節） |
| 8 | テストの補強 | 修正済み | 4.5 |
| 9 | CI と依存関係 | 修正済み | 4.6-7・4.8-2 |
| 10 | プラグインの細部（権限、目標のマスク、毎回の起動、重複記録） | 一部修正 | 権限 4.6-6、目標のマスク 4.6-4、重複 4.1-6 は修正済み。毎回の起動（4.4-4）は未修正 |
| 11 | CLI の使い勝手 | 修正済み | 4.1-2・4.7-3 |
| 12 | 誤った主張（費用、「10 of the 15」） | 修正済み | 4.4-3・4.7-2 |
| 13 | 保守の文書（CONTRIBUTING、SECURITY、テンプレート、Node 22） | 修正済み | 4.9-1。Node 22 の明記はラウンド1 `f7fd254` |
| 14 | 評価データの不整合 | 新しい課題は修正済み、既存データは未修正（記録） | 4.3-6a〜d。既存データは再現性のため書き換えず、設計文書 補足A に記録 |

「再現せず」と判定した指摘はありませんでした。

## 付録 A：「未修正」の再現（コマンドと出力）

すべて API キーを外した状態で実行しました。

### A-1 主要評価は全条件で合格（4.2-1、4.3-1）

```console
$ cd packages/core && node eval/tasks.mjs --report eval/results/tasks-holdout.json
$ node eval/tasks.mjs --report eval/results/tasks-holdout-sonnet.json
```

同じ保存データからの生成（Claude Haiku 4.5 と Claude Sonnet 5、各課題3回、95%CI）：

<!-- generated:prereg-primary -->
| condition | Claude Haiku 4.5 | Claude Sonnet 5 |
| --- | --- | --- |
| `full` | 100% [100%, 100%] | not run |
| `goal-only` | 0% [0%, 0%] | not run |
| `jev+user+marker` | 100% [100%, 100%] | 100% [100%, 100%] |
| `recency+user+marker` | 100% [100%, 100%] | 100% [100%, 100%] |
<!-- /generated:prereg-primary -->

### A-2 `room-booking` のログと雛形の矛盾（4.3-6b）

```console
$ sed -n 5p examples/eval-tasks/room-booking/template/logs/booking-errors-2026-09-22.txt
10:05 モバイル(v3.0) user=suzuki  A  9:30〜10:00   -> 201
$ node examples/eval-tasks/setup.mjs room-booking /tmp/rb && cd /tmp/rb
$ node --input-type=module -e "import('./src/booking.js').then(m => console.log(JSON.stringify(m.canBook([], { room: 'A', start: '9:30', end: '10:00' }))))"
{"ok":false,"code":"INVALID_RANGE"}
```

雛形は時刻を文字列で比べるため `'9:30' >= '10:00'` が真になり、ログの「201（成功）」と食い違います。

### A-3 形式1の履歴コミットが空（4.3-6a）

```console
$ node examples/eval-tasks/setup.mjs config-precedence /tmp/cp
$ git -C /tmp/cp log --format='%h %s'
4274e71 Bump image to 7.3.1
180a449 k8s: move env vars to SHOPAPI_ prefix (platform migration)
9cfd4aa Catalog routes with 60s cache
77b8f5b Layered config: default, per-env file, env overrides
6b4691b Initial shop-api service
$ for c in 4274e71 180a449 9cfd4aa 77b8f5b; do git -C /tmp/cp show --format= --name-only $c | wc -l; done
0
0
0
0
```

### A-4 日本語ホールドアウトのプローブが英語（4.3-6c）

```console
room-booking   holdout  probes 7, questions in Japanese 0 "Why do mobile bookings get wrongly rejected or wrongly accepted?"
shipping-fee   holdout  probes 7, questions in Japanese 0 "Why are orders below the advertised 5,000-yen pre-tax threshold getti…
csv-import-encoding dev probes 7, questions in Japanese 7 "両方の取引先の問題に共通する原因は?"
```

（`examples/eval-sessions/recorded-*.json` のうち日本語課題を数えたスクリプトの出力。dev の日本語4課題はすべて日本語）

### A-5 形式1の隠しテストの `git diff HEAD`（4.3-6d）

```console
$ grep -ln "'diff'" examples/eval-tasks/*/hidden/*.js | wc -l
7
$ grep -n "'diff'" examples/eval-tasks/upload-size-limit/hidden/acceptance.test.js
37:  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'config/upload.json'], { stdio: 'pipe' }))
```

回避できることは `node eval/harness-selftest.mjs` の「(a git diff HEAD check is fooled by the commit)」が示します（形式2の見本の課題で、保護されたファイルを変更してコミットすると `git diff --quiet HEAD` は成功する）。

### A-6 毎回の入力での Node の起動（4.4-4）

```console
statusHook.js on an ordinary prompt, 10 runs: mean 72.2 ms, min 62.7 max 105.6
```

（`/ctxjev:status` ではない普通の入力で `dist/statusHook.js` を10回起動して計測。何も出力せずに終了することも確認）

### A-7 カバレッジ、古い版のタグ、npm の版（4.8-3、4.8-4、4.7-1）

```console
$ grep -c coverage .github/workflows/ci.yml
0
$ git tag -l 'v*'
v0.3.0
v0.3.1
v0.4.0
v0.5.0
$ npm view ctxjev-cli version
0.5.0
```
