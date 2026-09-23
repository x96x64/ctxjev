# invoice-batch

毎日 00:05(日本時間)に動く請求書発行バッチと、月次レポート。
- `src/billing/issueInvoices.js`: 請求書の発行
- `src/reports/monthly.js`: 月次レポートの締め日
- `src/lib/date.js`: 日付ユーティリティ(日本時間への変換など)
