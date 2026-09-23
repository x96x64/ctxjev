# media-upload

Accepts user uploads for the web and mobile apps and tracks each account's storage quota.

- `src/validate.js`: per-file checks before an upload is accepted
- `src/size.js`: parses sizes like "10MB" from config
- `src/quota.js`: storage quota per plan
- `config/upload.json`: upload settings, also read by the ops dashboard
- `npm test` runs the suite with node:test
