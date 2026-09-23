# inventory-sync

Pulls stock levels from the warehouse API every minute. HTTP calls go through `src/http/client.js`,
whose retry rules live in `src/http/retryPolicy.js`.
