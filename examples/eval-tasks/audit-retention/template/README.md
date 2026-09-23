# audit-service

Stores audit events (logins, permission changes, exports) and purges old ones nightly.

- `src/retention.js`: which events the nightly purge deletes
- `scripts/purge.js`: the nightly purge job (runs in dry-run mode unless told otherwise)
- `src/report.js`: the monthly compliance report
- `npm test` runs the suite with node:test
