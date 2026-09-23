# ec-shipping

EC サイトの送料計算。金額はすべて円の整数。

- `src/shipping.js`: 注文ごとの送料（請求書サービスからも呼ばれる）
- `config/regions.json`: 都道府県ごとの送料（倉庫側のツールも読む）
- `src/delivery.js`: お届け予定日
- `npm test` でテスト（node:test）
