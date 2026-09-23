# room-booking

社内の会議室予約 API。予約は 1 日単位で、時刻は 24 時間表記の文字列。

- `src/booking.js`: 予約できるかの判定（フロントはエラーコードで表示を切り替える）
- `src/rooms.js`: 会議室の一覧
- `src/notify.js`: 予約確定の通知文
- `npm test` でテスト（node:test）
