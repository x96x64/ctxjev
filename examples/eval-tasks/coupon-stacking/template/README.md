# checkout-pricing

Prices a cart at checkout: subtotal, coupons, tax. All amounts are integer cents.

- `src/coupons.js`: coupon application, called by the checkout UI and the receipts service
- `src/catalog.js`: the active coupon codes
- `src/tax.js`: sales tax on the discounted total
- `npm test` runs the suite with node:test
