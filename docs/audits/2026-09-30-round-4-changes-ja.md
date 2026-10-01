# 第4回監査への対応記録（Round 4）

- 対象の監査：[`2026-09-30-audit-4-ja.md`](2026-09-30-audit-4-ja.md)（レビュー対象 `afecaba`）
- この記録の数値は、すべて保存済みの出力（[`2026-09-30-round-4-results/`](2026-09-30-round-4-results/)）から取っています。マスクの holdout の数値は、`packages/core/eval/check-docs.mjs` が保存済みの出力から書き込む生成ブロックです（手で打っていません）。
- 自己採点はしていません。

## 用語

- **マスク**：記録の中の秘密（パスワードやキー）を `[REDACTED]` に置き換えること。
- **ブラインドコーパス**：マスクのコードを見ていない別の AI が書いた、秘密を含む行と、秘密に見えて無害な行の集まり。作った人がテストを自分に都合よく作れないようにするためのもの。
- **dev / holdout**：コーパスを乱数で半分に分けたもの。dev は直すときに見てよい半分、holdout は最後に一度だけ測る半分。
- **blocking（止める指摘）**：今回の規則で「直すまでマージしない」とした指摘。0.7.0 からの後退、よくある秘密の漏れ、入力の長さに比例しない（2乗などの）遅さ、落ちる・止まる、ライセンスの抜け、何も確かめていないテストの6種類。

## PR とマージのコミット

| PR | 内容 | マージのコミット | 主なコミット |
|---|---|---|---|
| [#26](https://github.com/x96x64/ctxjev/pull/26) | マスク（P0-1、P2-9、新しいブラインドコーパス、P2-10、2b） | `f0c689a` | `36d62a3`、`ae266b9`、`cde06ab`、`df70e33` |
| [#28](https://github.com/x96x64/ctxjev/pull/28) | プラグイン・MCP・CLI（P1-5、P1-7、P2-11、P2-12、P2-13、#20） | `f2a813f` | `a4e9f9f`、`f040ee4` |
| [#30](https://github.com/x96x64/ctxjev/pull/30) | 文書と CI（P1-4、P2-15、ライセンスの記述、README の例の検査） | `6549104` | `accbeac`、`857e85b`、`3b440d3` |
| [#32](https://github.com/x96x64/ctxjev/pull/32) | 0.7.1 のリリース | `3feba93` | `fd3e40c` |
| [#33](https://github.com/x96x64/ctxjev/pull/33) | 新しい holdout の測定結果（一度だけ）と、この記録 | この PR のページを参照（この文書を含む PR なので、そのマージのコミットはこの中には書けない） | この PR のコミット |

どの PR も、必須の4つのチェック（`test (20)`、`test (22)`、`eval-harness`、`audit`）が成功してからマージコミットでマージし、ブランチは自動で削除されました。マージ後の `main` の CI は、#33 の後だけ失敗しました。

- 失敗したのは、今回は触っていない `tokenEstimate.test.ts` のテスト（絵文字 5,000 個を数える）です。網羅率（どのコードがテストで実行されたか）の計測つきの実行で、時間の上限 5 秒を超えました（CI の実行 149）。
- 遅いのは、比べる基準にしている外部ライブラリの計算です。同じ中身が、#33 自身の CI では合格していました。
- 隣の同じ種類のテストと同じ 60 秒の上限を付けて、直しました。確かめる中身は変えていません。これは、この記録の後の PR で行いました。
- CI の記録から、ほかにも上限に近いテストがないかを調べました。結果は [ci-time-limits.txt](2026-09-30-round-4-results/ci-time-limits.txt) にあります。

## 項目ごとの状態

番号は監査の第7節のものです。「失敗→合格のテスト」は、直す前のコードで失敗し、直した後に合格したテストです。直す前の実行結果は `2026-09-30-round-4-results/` に保存してあります。

### P0-1 引用符なしの `.env` 値に記号が入ると漏れる — 修正済み

- PR：#26（`36d62a3`。独立レビューの指摘を `ae266b9`・`cde06ab` で修正）
- 直したこと：行の終わりまで続く、引用符なしの値（`.env`、`export`、YAML、ログの最後の項目）は、記号がいくつ入っていても行末（またはその後ろの ` #` のコメントの手前）までを値として隠すようにしました。関数の呼び出しなどのコードに見えるもの（`get_token()`、`request.form['password']`）は、括弧が釣り合っていて中身が名前と数字だけのときに限り、そのまま残します。
- 失敗→合格のテスト：
  - `packages/core/src/redact.test.ts` の「the fourth audit — unquoted values with punctuation」。監査の総当たり（28記号 × 6種の名前 × 3種の区切り＝504行）をそのまま入れました。0.7.0 では 504 行中 306 行しか隠せず、監査と同じ11記号（`& ( ) , ; < > [ ] { }`）がそれぞれ 18/18 件漏れました。直した後は 504/504 です（[redact-coverage-0.7.0.txt](2026-09-30-round-4-results/redact-coverage-0.7.0.txt)、[redact-coverage-after.txt](2026-09-30-round-4-results/redact-coverage-after.txt)）。
  - 通り道ごとに確かめました。Jev に送る要求は `packages/core/src/jevClient.test.ts`、保存ファイル・圧縮後に戻す抜粋・状態報告は `packages/claude-plugin/src/secrets.test.ts` です。後者は、出荷する `dist/` のフックを実際に動かして確かめています。0.7.0 のマスクのコードでは、これらがすべて失敗しました（[masking-tests-on-0.7.0.txt](2026-09-30-round-4-results/masking-tests-on-0.7.0.txt)）。
  - 独立レビューが見つけた6件（後で述べます）は、`redact.test.ts` の「the review of the fourth audit's masking change」に入れました。修正前のコード（`36d62a3`）では 24 件が失敗しました（[review-fixes-before.txt](2026-09-30-round-4-results/review-fixes-before.txt)）。

### P2-9 隠しすぎ（`${VAR}` の破損、版番号） — 修正済み

- PR：#26（`36d62a3`、`ae266b9`、`cde06ab`）
- 直したこと：
  - `password: ${DB_PASSWORD}` が `[REDACTED]{DB_PASSWORD}` に壊れなくなりました。
  - `"jsonwebtoken": "^9.0.2"` の版番号も隠さなくなりました。
  - ただし、次の3つは今までどおり隠します。既定値付きの `${NAME:-…}` と `${NAME-…}`（既定値そのものが秘密のことがあるため）、版番号に見えるパスワード、版番号の後ろに任意の文字列が続く値。
  - 0.7.0 が先に走らせる 0.6.1 の規則（`redactLegacy.ts`）も同じ隠しすぎをしていたので、同じように直しました。変えた判断は、そのファイルの冒頭に書き出してあります。
- 失敗→合格のテスト：`redact.test.ts` の `AUDIT4_HARMLESS` の各行と、「keeps the dependency versions in examples/eval-sessions/webpack-upgrade.json」です。後者は、監査が挙げた評価データ `webpack-upgrade.json` を読むだけで、変更はしていません。0.7.0 では、そのデータの `"jsonwebtoken": "^9.0.2"` が `[REDACTED]` になりました。

### 新しいブラインドコーパス — 作成済み、holdout は一度だけ測定

- PR：#26（`36d62a3`）でコーパスを追加しました。holdout の測定結果は #33 で追加しました。
- 作り方：
  - `redact.ts` もテストの表も見ていない別のエージェントに、短い仕様だけを渡して書かせました。仕様の全文は `packages/core/test/blind-redact-2/README.md` にあります。
  - できたのは、秘密を含む行 184 件と、紛らわしいが無害な行 82 件です。秘密を含む行には、記号入りで引用符のない `.env` の値が入っています。無害な行には、プレースホルダー、版番号、ハッシュ、UUID が入っています。
  - どの行も読む前に、乱数で dev と holdout に半分ずつ分けました（種 2705319614）。dev は秘密 92・無害 41 行、holdout も秘密 92・無害 41 行で、両方をコミットしました。
  - holdout の中身は、測る前にも後にも見ていません。測定のスクリプトは割合しか出しません。
- 結果は、下の「ブラインドコーパスの結果」に書きました。

### P1-7 プラグインの LICENSE と同梱ライブラリの著作権表示 — 修正済み

- PR：#28（`a4e9f9f`、`f040ee4`）
- 直したこと：
  - `packages/claude-plugin/LICENSE` を追加しました。中身はルートの `LICENSE` と同じで、同じであることをテストで確かめています。
  - `THIRD_PARTY_NOTICES` も追加しました。ビルドのたびに、実際に出力に入ったライブラリの一覧から生成します（今は `@typesafe-ai/sdk` の MIT ライセンスの全文と「Copyright (c) 2026 TypeSafe」）。
  - レビューで、`gpt-tokenizer` は使われない部分として削られていて、実際には同梱されていないと分かりました。そこで、表示に載せるのを「出力に1バイト以上入ったもの」だけにしました（`f040ee4`）。
  - ライセンスファイルのないライブラリが同梱されると、ビルドが失敗します。CI の「コミット済みのバンドルがソースと一致するか」の検査も、このファイルを見ます。
  - README のライセンスの節は、直接の依存と、その下の依存（間接の依存）を分けて書くように直しました（#30）。
- 失敗→合格のテスト：`packages/claude-plugin/src/license.test.ts`（[pr2-tests-before-fix.txt](2026-09-30-round-4-results/pr2-tests-before-fix.txt)）
- マーケットプレイス形式の導入に両方のファイルが入ることは、リリース後に確かめました（下の「リリース」）。

### P1-5 MCP のオフライン採点 — 修正済み

- PR：#28（`a4e9f9f`）
- 直したこと：
  - 2つのツールに `scorer`（`jev`｜`local`｜`recency`）を加えました。
  - 既定は、互換性のため `jev` のままです。キーが必要なのは `jev` のときだけです。
  - MCP の README と、キーがないときの起動時の案内文も直しました。案内文の修正は #32 の `fd3e40c` です。
- 失敗→合格のテスト：`packages/mcp-server/src/server.test.ts`（キーなしで `local`／`recency` が動く、スキーマに `scorer` がある、知らない採点方式を拒む、起動時の案内）。[pr2-tests-before-fix.txt](2026-09-30-round-4-results/pr2-tests-before-fix.txt)、[release-tests-before-fix.txt](2026-09-30-round-4-results/release-tests-before-fix.txt) を参照。

### P1-4 `check-sessions.mjs` が 0 件で成功しない — 修正済み

- PR：#30（`accbeac`、`3b440d3`）
- 直したこと：
  - 検査する対象を、日本語のすべての評価用の会話に広げました。今は8件あり、課題のあるもの6件と手書きのもの2件です。
  - 確認用の質問の英語の項目は、次の2件の既知の数だけを許します。数が変われば失敗します。
    - `recorded-room-booking.json`：14項目
    - `recorded-shipping-fee.json`：12項目
  - 1件も検査しなかったときも失敗します。
  - CI はそのまま、本当に中身を検査したうえで合格します。
  - `examples/eval-tasks/` と `examples/eval-sessions/` は変えていません。
- 失敗→合格のテスト：`packages/core/eval/check-sessions.test.mjs`（[pr3-tests-before-fix.txt](2026-09-30-round-4-results/pr3-tests-before-fix.txt)）
- 限界：許すのは英語の項目の「数」で、「どの項目か」ではありません（#31）。

### P2-10 壊れた測定スクリプト `scripts/redact-coverage.ts` — 修正済み

- PR：#26（`36d62a3`）
- 直したこと：
  - 読み込みの処理を `scripts/loadRedact.ts` にまとめ、`redact-blind.ts` と共有するようにしました。
  - 監査の 504 行の総当たりも数えるようにしました。
  - 作業中のコードで見逃しか誤検出があれば、失敗します。
  - CI の `eval-harness` ジョブで実行するようにしました。
- 再現：直す前は `ERR_MODULE_NOT_FOUND`（`redactLegacy.js` が見つからない）で止まりました。直した後の出力は [redact-coverage-after.txt](2026-09-30-round-4-results/redact-coverage-after.txt) です。

### P2-11 BOM 付きの JSON — 修正済み

- PR：#28（`a4e9f9f`）
- 失敗→合格のテスト：`packages/cli/src/prune.test.ts` の「reads a JSON file that starts with a UTF-8 byte order mark」。直す前は「✖ could not parse this file: it's not valid JSON」で終わりました。

### P2-12 Jev の応答値の検証 — 修正済み

- PR：#28（`a4e9f9f`）
- 直したこと：
  - Jev が返した値が、0 から 1 の有限の数でなければエラーにします。エラーには、どの項目の値かを書きます。
  - 値はすべて先に確かめてから使うので、1つでもおかしければ何もキャッシュ（再利用のための保存）しません。
- 失敗→合格のテスト：`packages/core/src/jevClient.test.ts` の「rejects a probability that is …」の6件（文字列、NaN、Infinity、1より大きい、0より小さい、null）。

### P2-13 毎回の発言で動くフックを軽くする — 修正済み

- PR：#28（`a4e9f9f`）
- 直したこと：
  - `statusHook.js` は、まず発言が `/ctxjev:status` かどうかだけを見ます。そうでなければ、何も読み込まずに終わります。
  - 報告を作る部分（`dist/status.js`）は、`/ctxjev:status` のときだけ読み込みます。
  - `hooks.json` は変えていません。
- 計測は `scripts/time-status-hook.mjs` で、40回の中央値です。
  - 普通の発言にかかる時間：49.3 ms → 33.1 ms
  - 素の Node の起動との差：+23.2 ms → +7.1 ms
  - 出典：[status-hook-time-before.txt](2026-09-30-round-4-results/status-hook-time-before.txt)、[status-hook-time-after.txt](2026-09-30-round-4-results/status-hook-time-after.txt)
- 失敗→合格のテスト：`packages/claude-plugin/src/statusHook.test.ts` の「loads the status report only for /ctxjev:status」。フックだけを別の場所にコピーして動かし、報告を読み込んでいないことを確かめます。

### P2-15 README の冒頭と CONTRIBUTING — 修正済み

- PR：#30（`accbeac`、`3b440d3`）
- 直したこと：README の冒頭に5行の要約を置きました。書いたのは次の4点です。
  - CLI とプラグインは、既定では何も送らない
  - Jev は自分で選んだときだけ使う（MCP のツールは既定で Jev）
  - 設計に使っていない課題では、どの採点方式もまだ単純な切り捨てに勝っていない
  - リポジトリの `.mcp.json` を使うには、先に `pnpm build` が必要
- CONTRIBUTING にも、`.mcp.json` の前提を書きました。
- レビューの blocking 1件：1行目の「既定では何も送らない」が MCP のツールには当てはまらない、という指摘です。`3b440d3` で、CLI とプラグインに限る書き方に直しました。
- この項目は文書なのでテストはありません。代わりに、README の出力例を実際に動かして1バイト単位で比べる `scripts/check-readme-examples.mjs` を足し、CI で動かしています（`857e85b`）。追加の理由は、#28 で足した警告のせいで README の出力例が古くなっていたのを、この検査が見つけたからです（[pr3-tests-before-fix.txt](2026-09-30-round-4-results/pr3-tests-before-fix.txt)：main の上で 4 例中 1 例しか一致しなかった）。

### 2b 正直さ：マスクのブラインド holdout の結果を README に載せる — 修正済み

- PR：#26（`36d62a3`）、#33
- README の Design Notes に、各コーパスの holdout の結果を載せました。`check-docs.mjs` が保存済みの出力から生成し、CI で照合しています。この記録の次の行も同じ仕組みで生成しています。
  - <!-- generated:masking-blind-ja -->Round 3 のコーパス（0.7.0）：秘密を含む行の検出 84/91（92.3%）、無害な行の誤検出 6/42（14.3%）。Round 4 のコーパス（0.7.1）：秘密を含む行の検出 80/92（87.0%）、無害な行の誤検出 3/41（7.3%）。Round 5 のコーパス（0.7.2）：秘密を含む行の検出 101/118（85.6%）、無害な行の誤検出 3/80（3.8%）<!-- /generated:masking-blind-ja -->
- CHANGELOG の 0.7.1 にも、Round 3 のコーパスの holdout の結果を書きました。

### issue #20 の小さな不具合

- **`--protect-last ""` を 0 として扱う — 修正済み**
  - PR：#28（`a4e9f9f`）
  - 空や空白だけの値は、`--protect-last`・`--target-tokens`・`--min-saved-tokens` のどれでもエラーになります。
  - 失敗→合格のテスト：`prune.test.ts` の「rejects an empty --protect-last instead of reading it as 0」
- **ユーザーの項目がない記録で、最初の項目が黙って消える — 一部修正（警告は出す。守りはしない）**
  - PR：#28（`a4e9f9f`）
  - `prune` と `analyze` が「最初の項目を消した（消す）。この記録には、元の依頼として守れるユーザーの項目がない」と警告するようにしました。`analyze --json` にも出ます。
  - 最初の項目を代わりに守ることはしませんでした。ユーザーの項目がない記録では、最初の項目はたいていツールの結果で、依頼ではないからです（監査も、監査3が「最初の依頼」とした項目は実はツールの結果だったと書いています）。
  - 失敗→合格のテスト：`prune.test.ts` の「warns when it removes the first entry of a transcript with no user entry」と、`packages/core/src/pruneEntries.test.ts` の「names the first entry it removed when there is no user entry to protect」

### 見送ったもの（範囲外）

- P0-2（判別力のある新しい holdout 課題）、P1-3（プラグインの既定の評価）：お金のかかる評価と、新しい holdout の課題が必要です。Round 2 の作業として見送りました。
- P1-8（AI 採点者の人手チェック）：人の作業が必要なため、見送りました。
- P1-6（リリースタグ `v*` の保護）：今回の依頼の範囲に入っていません。また、GitHub の設定の変更は、この環境の中継（プロキシ）では行えません。最後に、クリック手順を書きました。
- P2-14（テストの穴、網羅率の下限の引き上げ）：今回の依頼の範囲に入っていないため、見送りました。
- 評価データ（`examples/eval-tasks/`、`examples/eval-sessions/`）は変えていません。

## ブラインドコーパスの結果

- 測り方は、何かを測る前に決めたものです（`packages/core/test/blindCorpus.ts`。Round 3 と同じ）。
  - 検出：秘密のどの8文字の断片も、出力に残っていないこと。
  - 誤検出：秘密でない行が少しでも変わったこと。
- dev の半分（直すときに使ってよい半分）の出典：[blind2-dev-before-0.7.0.txt](2026-09-30-round-4-results/blind2-dev-before-0.7.0.txt)、[blind2-dev-after.txt](2026-09-30-round-4-results/blind2-dev-after.txt)

| 時点 | 秘密を含む行の検出 | 隠した秘密の数 | 誤検出（無害な行を変えた割合） |
|---|---|---|---|
| 0.7.0（`afecaba`） | 71/92（77.2%） | 78/103（75.7%） | 7/41（17.1%） |
| 0.7.1（修正の後） | 86/92（93.5%） | 97/103（94.2%） | 1/41（2.4%） |

- dev で残った見逃し6件と誤検出1件は、`packages/core/src/redactBlind.test.ts` に番号で書き、[#27](https://github.com/x96x64/ctxjev/issues/27) に記録しました。
  - 見逃し：fish の `set -gx`、`snyk auth <UUID>`、ドイツ語とフランス語の文中のパスワードとトークン、Terraform の差分の新しい値、`vault kv get` が1行だけ出力したパスワード
  - 誤検出：AWS Secrets Manager の ARN の名前

### holdout の半分（公開後に一度だけ測定）

- 0.7.1 を公開した後、リリースのタグ `v0.7.1` のコードで、一度だけ測りました（[blind2-holdout.txt](2026-09-30-round-4-results/blind2-holdout.txt)）。
- holdout の行は、この測定の前にも後にも見ていません。調整にも使っていません。スクリプトは割合だけを出し、どの行を見逃したかは出しません。
- 結果（保存済みの出力から生成）：<!-- generated:masking-blind-ja -->Round 3 のコーパス（0.7.0）：秘密を含む行の検出 84/91（92.3%）、無害な行の誤検出 6/42（14.3%）。Round 4 のコーパス（0.7.1）：秘密を含む行の検出 80/92（87.0%）、無害な行の誤検出 3/41（7.3%）。Round 5 のコーパス（0.7.2）：秘密を含む行の検出 101/118（85.6%）、無害な行の誤検出 3/80（3.8%）<!-- /generated:masking-blind-ja -->

**読み方**

- **今回も、dev の数値は楽観的でした。** holdout の検出は dev の表の「0.7.1（修正の後）」より低く、誤検出は高くなりました。dev の値は、dev の見逃しを見ながら規則を足した結果なので、初めて見る行には当てはまりませんでした。
- **Round 3 のコーパスとは、数値を直接比べられません。** 書いた人（別の AI）も、行の中身も違います。今回の仕様では、監査が見つけた「記号入りの引用符なしの値」を多めに入れるよう頼みました。
- 0.7.0 の holdout での値は測っていません。holdout は一度だけ測る決まりなので、比べるために 0.7.0 でもう一度測ることはしませんでした。そのため、「この holdout の上で 0.7.0 より良くなった」とは言えません。言えるのは dev での改善（77.2% → 93.5%）だけで、それは楽観的な値です。
- holdout は使い切りました。次に独立に測るには、新しいコーパスが要ります。

## 独立レビュー（止める規則で「止める」とした指摘）

各 PR で、作業を見ていない別のエージェントに、一度だけレビューさせました。直した後の再レビューも、多くて一度だけです。

- **#26（マスク）**
  - 1回目のレビューは、利用上限のエラーで途中で終わり、結果が失われました。そこで、新しいレビューを一度だけやり直しました。
  - blocking は6件で、すべて `ae266b9` で直しました。
    1. `${VAR-既定値}`（コロンなし）の既定値が隠れなくなっていた
    2. `$` で始まる URL のパスワードが隠れなくなっていた
    3. 版番号の例外がパスワードにも効いていた
    4. 省略例の例外が広すぎた
    5. 1行に ` #` が多いと処理時間が2乗で増えた
    6. 括弧が釣り合ったパスワードを、コードと誤って残していた
  - 再レビューでは、6件とも直っていて、新たな blocking はありませんでした。
  - 再レビューが挙げた小さな残り（`password=Summer_2024_...`、何も確かめていなかったテストの1行）は、`cde06ab` で直しました。
- **#28（プラグイン・MCP・CLI）**
  - blocking は0件でした。
  - 「`gpt-tokenizer` は実際には同梱されていない」という指摘を受けて、`f040ee4` で表示を正しくしました。
  - 残りは [#29](https://github.com/x96x64/ctxjev/issues/29) に記録しました。
- **#30（文書と CI）**
  - blocking は1件でした。README の要約の「既定では何も送らない」が MCP のツールに当てはまらない、という指摘で、`3b440d3` で直しました。
  - 再レビューでは、直っていて、新たな blocking はありませんでした。
  - 残りは [#31](https://github.com/x96x64/ctxjev/issues/31) に記録しました。
- blocking にあたらない指摘は、すべて issue（#27、#29、#31）と、CHANGELOG の「Known issues」に書きました。

## リリース（0.7.1）

- **版番号を 0.7.1 にした理由**：CONTRIBUTING の決まりでは、0.x の間は、既定値の変更か選択肢の削除があるときだけマイナー（0.8.0）を上げます。今回はどちらもありません（MCP の `scorer` は追加で、既定は 0.7.0 と同じ）。
- **マージの前の確認**
  - 3つのパッケージを tarball にして、キーなしで空のフォルダに入れました。README の Jev 以外の出力例は、4例とも1バイトも違わず一致しました。入れた MCP サーバーは、キーなしで `local` と `recency` が動きました（[release-prepublish-install.txt](2026-09-30-round-4-results/release-prepublish-install.txt)）。
  - この確認で、MCP サーバーの起動時の案内文「キーがないと、どの呼び出しもエラーになる」が誤りになっていたのが見つかりました。テストを先に書いてから直しました（`fd3e40c`）。
  - キーありで、公開ワークフローと同じ検査を実行しました。版番号の検査、ライブテストを含む全テスト、評価ゲートの3つで、すべて合格しました（[release-publish-checks.txt](2026-09-30-round-4-results/release-publish-checks.txt)）。
- **公開**
  - 持ち主が「Publish to npm」を `main` から実行しました（実行 #22、対象は `3feba93`）。
  - 16のステップは、すべて成功しました。main から以外の公開を拒否する検査、CI 合格の確認、版番号の検査、テスト、評価ゲート、3パッケージの公開、タグと GitHub Release の作成です。
- **公開の後の確認**（[release-postpublish-checks.txt](2026-09-30-round-4-results/release-postpublish-checks.txt)、[release-marketplace-install.txt](2026-09-30-round-4-results/release-marketplace-install.txt)）
  - npm の `latest` は、3つのパッケージとも 0.7.1 です。公開の直後は、npm の一覧のキャッシュ（一時保存）で数分だけ 0.7.0 と表示されました。
  - GitHub の Release は、`v0.7.1` が Latest です。タグは `3feba93` を指しています。
  - npm からのきれいなインストールでも、README の Jev 以外の出力例は4例とも一致しました。
  - npm から入れた MCP サーバーは、キーなしで `scorer: "local"` と `"recency"` が動き、既定（Jev）ではキーがないと答えました。
  - 一時的な Claude Code の設定で、マーケットプレイスからプラグインを入れました。導入先に `LICENSE` と `THIRD_PARTY_NOTICES` があり、中身はリポジトリと同じでした。
  - README のクイックスタートの `curl` は、`raw.githubusercontent.com` がこの環境の中継で遮断されるため試せませんでした。同じファイルをリポジトリから使いました。
- **Jev の費用**
  - 使ったのは、公開前のライブテストと評価ゲートだけです。
  - 手元の中継で、Jev の応答のトークン数を数えました。要求 124 回、入力 649,781 トークンで、約 $0.027 です（入力 100 万トークンあたり $0.042、出力は無料）。
  - 公開ワークフロー自体も、同じ検査で Jev を呼んでいます。その費用は GitHub の実行の中なので、ここには含めていません。
  - お金のかかる Claude のエージェント評価は、実行していません。

## 残っていること

- 範囲外として見送ったもの（P0-2、P1-3、P1-8、P1-6、P2-14）は、上の「見送ったもの」に書きました。
- マスクの既知の漏れと誤検出は [#27](https://github.com/x96x64/ctxjev/issues/27)（と #16）に記録しました。
- 小さな改善点は [#29](https://github.com/x96x64/ctxjev/issues/29) と [#31](https://github.com/x96x64/ctxjev/issues/31) に記録しました。

## 付録：CHANGELOG の 0.7.1 の節から移した詳細（Round 5 で移動）

第5回の監査（`docs/audits/2026-10-01-audit-5-ja.md`、改善12）は、`CHANGELOG.md` の 0.7.1 の節が74行あり、`CLAUDE.md` の決まり（利用者向けに1変更1行）を守っていないと指摘しました。Round 5 でその節を5行の要約に縮め、調査の細部はここに移しました。内容は、0.7.1 の公開時に CHANGELOG に書いたものと同じです（日本語に訳しました）。

- **引用符なしの値の途中の記号（第4回の P0-1）**：`.env` ファイル、`export` の行、YAML、ログの行末の `DB_PASSWORD=Qx7vR2mK(pL9zW4tB` のような値は、0.7.0 では `(` や `[` の後ろで丸ごと、または最初の `& ) , ; < > ] { }` から後ろが隠されずに残りました。すべての経路（Jev への送信、プラグインの `preserved.json`、圧縮後の再注入）でそうでした。0.7.1 では、行末で終わる引用符なしの値を、行末（または ` #` のコメント）まで隠します。第4回の総当たり（28 記号 × 6 名前 × 3 区切り＝504 行）は、0.7.0 の 306 行に対し、0.7.1 では 504 行すべてが隠されます。
- **プレースホルダーと版番号の誤検出（第4回の P2-9）**：`password: ${DB_PASSWORD}` が `password: [REDACTED]{DB_PASSWORD}` に壊れ、`"jsonwebtoken": "^9.0.2"` の版番号が `[REDACTED]` になっていました。0.7.1 では、次のものもそのまま残します：Spring の `${a.b}` と `${NAME:}`、URL のパスワードの `********` や `${NAME}`、接頭辞で切った例（`sk-ant-...`）、`- name: DB_PASSWORD` の後ろの Helm テンプレート、`…Pw==` で終わる base64、`secret_key = settings.SECRET_KEY` や `config.Password` のような参照。これは、0.7.0 が先にそのまま走らせていた 0.6.1 の規則も変えています。引き続き隠すもの：既定値（`${NAME:-…}`、`${NAME-…}`。それ自体が秘密かもしれないため）、版番号に見えるパスワードや `_...` で終わるパスワード、プレリリースの語以外の接尾辞が付いた版番号（`1.2.3-<token>`）。
- **"application key"**（`DD-APPLICATION-KEY: …`）を隠すようにしました。
- **ブラインドでの測定**：README の Design Notes に、マスクのコードを見ずに書かれた各コーパスの holdout の結果を、保存した出力から生成して載せました。新しいコーパス（`packages/core/test/blind-redact-2/`）が使い切ったコーパスの代わりになり、その holdout の半分は 0.7.1 の上で一度だけ測りました（結果は上の「ブラインドコーパスの結果」）。
- **MCP**：2つのツールが `scorer` を取るようにしました。`"jev"`（既定。従来どおり）、`"local"`（キーワードの重なり）、`"recency"`（単純な切り捨て）です。後の2つはオフラインで動き、キー無しでも使え、何も送りません。キー無しで起動したときの注意文も、「すべての呼び出しが失敗する」ではなく、この内容に直しました。
- **CLI**：UTF-8 の BOM 付きの JSON を読めるようにしました（Windows のメモ帳が付けるもので、以前は「not valid JSON」で拒否していました）。空の `--protect-last ""`（`--target-tokens ""`、`--min-saved-tokens ""` も）はエラーにしました。以前は 0 と読み、`--protect-last` では何も守りませんでした。
- **CLI・core**：ctxjev 独自形式の `prune`/`analyze` で、ユーザーの項目が無い記録の最初の項目を消すときに警告を出すようにしました（`pruneEntries()` は `firstEntryRemovedWithoutUserEntry` で報告）。その項目は残しません。ユーザーの項目が無い記録では、最初の項目はふつうツールの結果だからです。
- **core**：Jev の答えが 0〜1 の有限の数でないときは、その項目を名指ししたエラーにし、その応答から何もキャッシュしないようにしました。
- **プラグイン**：`/ctxjev:status` に答えるフック（Claude Code がすべてのプロンプトで走らせる）は、ほかのものを読み込む前にプロンプトを確かめます。普通のプロンプトの負担は、何もしない `node` の起動に比べて約 23 ms から約 7 ms に減りました（40 回の中央値、`node scripts/time-status-hook.mjs`）。
- **プラグイン**：ディレクトリに `LICENSE` と `THIRD_PARTY_NOTICES` を入れました（同梱したパッケージのライセンス全文と著作権表示。現在は `@typesafe-ai/sdk`、MIT。ビルドで生成）。そのディレクトリだけを複製するマーケットプレイスからの導入には、どちらも入っていませんでした。
- **スクリプトと評価データの検査**：`scripts/redact-coverage.ts` は 0.7.0 から `ERR_MODULE_NOT_FOUND` で落ちていましたが、再び動くようにし、CI でも走らせます。`packages/core/eval/check-sessions.mjs` は形式2の会話（まだ1つも無い）だけを検査していたため、CI は何も検査せずに通っていました。日本語のすべての会話の質問を検査し、形式1の holdout の2つの会話には既知の数だけ英語の項目を許し、新しいものや、検査した会話が0件のときは失敗するようにしました。
- **文書**：README の冒頭に5行の要約（CLI とプラグインは既定で何も送らない、Jev はそこでは任意で MCP の既定、どの採点方式もまだ未知の課題で単純な切り捨てに勝っていない）を入れました。ライセンスの節は、直接の依存とその下の依存を分け、BSD ライセンスのものを名指ししました。CONTRIBUTING には、リポジトリの `.mcp.json` は先に `pnpm build` が要ると書きました。`checkout-bug.json` での `ctxjev analyze`・`ctxjev prune` の README の例に新しい警告を反映し、CI は Jev を使わない README の例をすべて実行して実際の出力と比べるようになりました（`scripts/check-readme-examples.mjs`）。
