# payments-gateway

Receives PayRail webhooks (`POST /webhooks/payrail`) and applies them: captures, refunds, disputes.
Runs as 4 instances behind the load balancer. `src/db/` is a thin wrapper over Postgres; in tests
it's an in-memory fake with the same interface.
