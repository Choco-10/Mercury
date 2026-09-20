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
The catalog starts empty: add products in the UI (+ Add product), then upload
sales + competitor CSVs on the Data page.
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
  still require separate verification.

The server binds only 127.0.0.1 and restricts Host plus browser Origin. Browser CORS
allows http://localhost:5173 and http://127.0.0.1:5173 only; use that Vite port later.
POST requires application/json. Request bodies (including streamed uploads) are
capped at 2 MiB before routing; the CSV's separate 256 KiB limit still applies.
There are no cloud fallback, seed, reset or artifact-download routes.

## Frontend (two modes, one HTTP client)

The browser now always uses the backend over HTTP — there is no third
"browser demo" mode. Vite reads two build-time env vars:

- `VITE_API_MODE` — `localhost` (default) or `aws`.
- `VITE_API_BASE_URL` — for `localhost`, default `http://127.0.0.1:3001`;
  for `aws`, the API Gateway URL ending at `/prod`.

Local base `http://127.0.0.1:3001`; AWS base ends at `/prod`, not `/prod/api`,
because the frontend HTTP helper appends `/api` exactly once. Vite
configuration changes require restart/rebuild.

### Local dev (PowerShell, terminal 2)

```powershell
$env:VITE_API_MODE = "localhost"
$env:VITE_API_BASE_URL = "http://127.0.0.1:3001"
npm --prefix "C:\\Users\\harshiv\\Desktop\\Mercury\\frontend" run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open http://127.0.0.1:5173. The Products page now has a "+ Add product" button,
the Data page accepts sales + competitor CSV uploads, and AI Analyst returns
grounded multi-agent output. All routes hit the local loopback backend.

### AWS (after deployment; see aws.md)

```powershell
$env:VITE_API_MODE = "aws"
$env:VITE_API_BASE_URL = "<ApiUrl from sam deploy>"
```


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
when eventually deployed.
