# Ops notes

- 2026-08: platform team moved every service to SHOPAPI_-prefixed variables in the k8s manifests.
- Pool exhaustion alerts fire when `db pool wait > 200ms` for 5 minutes.
