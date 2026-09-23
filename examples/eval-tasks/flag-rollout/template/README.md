# checkout-web

Checkout backend for the web shop. Shipping options are built in `src/shipping/options.js`.
Feature gating: some features use environment variables (`src/config.js`), newer ones use the
flags service client in `src/flags/client.js` (per-user rollout, percentages, kill switch).
