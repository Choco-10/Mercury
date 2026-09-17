# Mercury — Amazon Seller Intelligence

Decision-support MVP for one demo seller and five products. Numerical forecasts, competitor metrics and pricing simulations are computed by application code, not an LLM. No automatic price changes or transactions.

## Current checkpoint

Phase 2 backend code and local integration are implemented. AWS deployment/integration of the current code is deferred. Localhost and Lambda share the router and ingestion/calculation services; storage is injected. Browser `local` mode is a separate read-only demo adapter, with representative happy-path parity tests (not complete behavioral parity).

Bedrock agents and scheduled workflows are NOT implemented. AI Analyst is deterministic demo behavior in browser-demo mode and a placeholder in HTTP modes. Forecasts remain a statistical baseline with uncalibrated nominal intervals; pricing assumes elasticity, not measured causal effects.

## Local start (PowerShell)

Terminal 1:
```powershell
node "C:\Users\harshiv\Desktop\Mercury\backend\local\start.mjs"
```

Terminal 2:
```powershell
$env:VITE_API_MODE = "localhost"
$env:VITE_API_BASE_URL = "http://127.0.0.1:3001"
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run dev -- --host 127.0.0.1 --port 5173 --strictPort
```
Open http://127.0.0.1:5173. Local storage resets on backend restart. Uploads change sales/competitor observations for existing products; they do not create products.

## Local validation

```powershell
npm --prefix "C:\Users\harshiv\Desktop\Mercury\backend" test
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" test
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run lint
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run build
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run smoke
```
For fresh dependency installation use `npm ci` in backend and frontend (npm downloads, not AWS calls). The deployable manifest/lockfile lives in backend/src. Do not seed, deploy, or select AWS mode during offline development.

## Documentation (absolute workspace paths)

- `C:\Users\harshiv\Desktop\Mercury\docs\phase2-local.md` — completion scope, checks and deferred integration gates
- `C:\Users\harshiv\Desktop\Mercury\docs\frontend-local-http.md` — browser configuration and manual smoke checklist
- `C:\Users\harshiv\Desktop\Mercury\docs\local-backend.md` — loopback server
- `C:\Users\harshiv\Desktop\Mercury\docs\product-api.md` — product/pricing contracts
- `C:\Users\harshiv\Desktop\Mercury\docs\analysis-api.md` — analysis snapshots
- `C:\Users\harshiv\Desktop\Mercury\docs\ingestion-api.md` — upload stages and outcomes
- `C:\Users\harshiv\Desktop\Mercury\docs\dynamodb-adapter.md` — keys, pagination and bounded retries

AWS usage is account-dependent and can consume credits even with a zero bill. Existing S3/DynamoDB/log storage can accrue usage while local development proceeds. No cleanup or destructive commands are part of local validation.

