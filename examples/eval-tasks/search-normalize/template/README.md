# catalog-search

商品カタログの全文検索(インメモリ)。
- `src/search/searchIndex.js`: インデックス作成と `normalize()`
- `src/search/query.js`: 検索クエリの処理
- `data/products.json`: 商品データ(毎晩 ERP から取り込み)
