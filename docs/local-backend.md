# Offline HTTP backend and AWS switch boundary

## Start (PowerShell, Node installed; backend dependencies already installed)

```powershell
node "C:\Users\harshiv\Desktop\Mercury\backend\local\start.mjs"
```

In a second terminal:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/products"
```

Stop with Ctrl+C. Port 3001 must be available; startup fails instead of silently
choosing another port. This launches only local code. No cloud client is selected
or called, even if AWS credentials or TABLE_NAME/BUCKET_NAME exist in your shell.
Five demo products, 120 days of sales, and competitor history are copied into memory.
Uploads replace matching natural keys and are visible on subsequent reads.
All local uploads, artifacts, snapshots and ledger records disappear on restart.
Do not use this server for real seller data or expose it through a tunnel.

## Shared production code, separate entry points

- Offline: backend/local/start.mjs -> local/server.mjs -> createHandler(memory store,
  memory artifact/ledger adapters) -> real backend services and ingestion pipeline.
- AWS: handlers/api.handler -> production store.js -> createHandler(DynamoDB store,
  S3 artifacts and DynamoDB ledger) -> those same services/pipeline.
- Local files live outside SAM CodeUri (backend/src) and are not needed by Lambda.
- No second implementation of pricing, forecasting, analysis or CSV normalization.
- Local transport creates stage-free HTTP API v2-style events. It is not an API
  Gateway emulator: IAM, AWS quotas, SDK transport, timeouts and service failures
  still require separate tests. Fake-transport regression tests cover the adapters.

The server binds only 127.0.0.1 and restricts Host plus browser Origin. Browser CORS
allows http://localhost:5173 and http://127.0.0.1:5173 only; use that Vite port later.
POST requires application/json. Request bodies (including streamed uploads) are
capped at 2 MiB before routing; the CSV's separate 256 KiB limit still applies.
There are no cloud fallback, seed, reset or artifact-download routes.

## Frontend switch: pending next small step

Leave VITE_API_MODE=local for now. Currently that means browser-only demo behavior,
not this HTTP server. A dedicated localhost mode still needs implementation/testing.
After that, localhost and AWS will share the HTTP client and differ by configuration:
local base http://127.0.0.1:3001; AWS base ends at /prod, not /prod/api, because the
frontend HTTP helper appends /api. Vite configuration changes require restart/rebuild.
No AWS mode has been enabled by this step.

## Legacy seed compatibility

Demo and previously seeded records use YYYY-MM-DDT00:00:00.000Z. Backend guards
require YYYY-MM-DD. Both local and DynamoDB read adapters now normalize that exact
legacy format for sales/competitor dates without modifying stored records.
Other timestamp formats are not silently accepted. CSV remains strict YYYY-MM-DD.
This fixes the observed empty forecast when first exercising the real demo over HTTP.

## Before switching to AWS

Still pending: frontend HTTP wiring/error rendering, deployable SDK dependency
packaging and lockfile (backend/src currently lacks dependency declarations), shared
analytics packaging, Node 22 validation, static SAM review, and bounded cloud checks.
Existing adapters/routes are production-directed code, not proof of cloud readiness.
We will prepare and test these locally before proposing deployment.
AWS requests, strong reads, ledger writes, S3 versions and logs can consume credits
when eventually deployed. Local tests do not stop existing cloud storage charges.

## Regression checks (PowerShell)

```powershell
$tests = Get-ChildItem -LiteralPath "C:\Users\harshiv\Desktop\Mercury\backend\tests" -Filter "*.test.mjs" |
    Select-Object -ExpandProperty FullName
node --test $tests
if ($LASTEXITCODE -ne 0) { throw "Backend tests failed" }
```

HTTP tests start loopback servers on ephemeral ports and close them automatically;
they make no AWS requests. Node 24 passes do not establish Lambda Node 22 parity.
