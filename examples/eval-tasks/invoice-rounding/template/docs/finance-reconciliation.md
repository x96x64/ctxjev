# Ledger reconciliation

Every night `reconcile.js` compares invoice totals with the finance ledger export. The ledger is the
source of truth: it computes each line's amount including tax, rounds that line to cents, and sums
the rounded lines. Any mismatch is reported to #billing-alerts.

Known mismatch causes in the past: currency conversion lag (fixed 2025-11), refunds posted to the
wrong period, and tax rate table updates arriving a day late.
