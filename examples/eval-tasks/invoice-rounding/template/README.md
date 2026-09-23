# billing-core

Invoice math shared by the billing API, the PDF renderer, and the nightly ledger reconciliation.
Amounts are dollars in, integer cents out.

- `src/invoice.js`: line amounts and invoice totals (v2 API)
- `src/legacy/`: the frozen v1 implementation, still served at /v1/invoices
- `src/tax.js`: regional tax rates
- `npm test` runs the suite with node:test
