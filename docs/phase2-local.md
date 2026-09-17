## Phase 2 local-code scope

Implemented locally: product and analysis APIs; DynamoDB keys/adapters with pagination and bounded unprocessed-write retries; S3 artifact adapter; CSV validation/normalization; upload checkpoint ledger and deterministic post-upload analysis; localhost dataset/object/ledger storage; frontend HTTP ingestion and error handling; deployable dependency lockfile and shared-code drift gate.

Not a claim of production readiness or browser click-through verification. Automated tests exercise pure view orchestration and real loopback HTTP, not an automated browser. No AWS service requests or deployment are required by the local checks below.

## Packaging

Canonical math: `C:\Users\harshiv\Desktop\Mercury\shared\analytics.js`.
Lambda copy: `C:\Users\harshiv\Desktop\Mercury\backend\src\shared\analytics.js`.
Edit only canonical math, then run:

```powershell
node "C:\Users\harshiv\Desktop\Mercury\backend\scripts\sync-shared.mjs"
node "C:\Users\harshiv\Desktop\Mercury\backend\scripts\sync-shared.mjs" --check
```

Backend test runner and package verification fail on drift. SDK direct dependencies are pinned in backend/src/package.json; backend/src/package-lock.json locks transitives. SAM retains CodeUri backend/src and handlers/api.handler and requests npm ci via UseNpmCi. Do not change module extensions or the handler to solve unrelated failures.

Offline Node 22 checks (first use may download the pinned runtime or npm dependencies, not AWS services):

```powershell
npm exec --yes --package=node@22.22.0 -- node "C:\Users\harshiv\Desktop\Mercury\backend\scripts\test.mjs"
npm exec --yes --package=node@22.22.0 -- node "C:\Users\harshiv\Desktop\Mercury\frontend\scripts\test.mjs"
npm exec --yes --package=node@22.22.0 -- node "C:\Users\harshiv\Desktop\Mercury\backend\scripts\verify-package.mjs"
```

Package verification copies only Lambda sources to a fresh OS temporary directory outside the repository; runs locked npm ci there; imports the real production handler and installed SDK modules under Node 22; replaces transports and blocks network calls in the probe. It verifies products and pricing through production wiring. It removes only its own temporary directory. This verifies dependency isolation on Windows, not the AWS Linux runtime, IAM, endpoint routing or timeouts.

## Local acceptance

- Backend regression suite includes stage-free/named-stage dispatch, parsing, products, analysis, pricing, CSV, partial persistence, artifact/ledger failures, pagination and retries.
- Frontend suite includes shared HTTP URL/error handling, real loopback upload/read-back, pure partial-data orchestration, and five-product demo/backend success contract parity.
- Browser demo and HTTP deliberately differ: browser demo has no ingestion; timestamps/model labels and sales date legacy formatting can differ. Negative/error parity is not claimed.
- Product detail retry reloads; optional endpoint failures preserve the rest of the page; pricing errors are caught. Catalog analysis failures no longer hide products or classify missing analysis as healthy. Summary values are labelled as partial.
- Manual browser check still required: start both servers per frontend-local-http.md, upload valid/invalid sales and competitor files, inspect counts/errors, check outcome and navigate to updated product analytics. Stop backend and reload: expect connection error, not demo fallback. Restore server and use retry.

## Explicit deferred work

AWS integration: reviewed SAM build/deployment, Linux runtime validation, route/CORS/IAM checks, real DynamoDB/S3 consistency, timeout testing. Existing cloud checkpoint only verifies products GET, not the new routes. Public wildcard CORS, no authentication, no API abuse/cost controls and no explicit log retention need a security/cost review before public exposure.

Upload consistency: not atomic across S3/DynamoDB/analysis/ledger; partial writes/artifacts can remain. Crash checkpoints may stay in_progress. No whole-upload automatic retry, rollback, deduplication or reconciliation. Repeated valid uploads replace natural-key data but create new artifact/analysis records. Concurrency is not a cross-query snapshot. Competitor latest reads traverse history; an optimized index requires a consistent write/migration design.

Later phases: forecast calibration/evaluation/service redesign, pricing model validation, grounded server-side Bedrock specialists, EventBridge/Step Functions and idempotent scheduled workflows. Pricing uses 21 records, assumed elasticity 1.4 and daily estimates; competitor_position labels currently refer to seller baseline, not actual competitor position. No numerical validity guarantee is implied by passing plumbing tests.

No resources were deleted or replaced. Existing cloud storage may consume credits independently of these local checks.
