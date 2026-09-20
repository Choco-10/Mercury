# Frontend local HTTP development

Two modes, one HTTP client — no browser-demo fallback:

- `localhost` (default): the real backend router over loopback HTTP, in-memory storage. No AWS fallback.
- `aws`: the same HTTP client over HTTPS against the deployed API Gateway.

PowerShell, terminal 1 (start the offline backend):

```powershell
node "C:\Users\harshiv\Desktop\Mercury\backend\local\start.mjs"
```

Terminal 2 (process environment overrides Vite .env files; no saved configuration changes):

```powershell
$env:VITE_API_MODE = "localhost"
$env:VITE_API_BASE_URL = "http://127.0.0.1:3001"
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open http://127.0.0.1:5173. Add a product with "+ Add product" on the Products
page, upload sales + competitor CSVs on the Data page, then open the product for
analytics and try the AI Analyst. All routes hit the local loopback backend.

The Data page has no separate CSV parser: the backend is authoritative. The
browser checks file size before reading. While processing, upload inputs are
disabled. No automatic upload retries or polling. The outcome is displayed once,
immediately after an upload; a page reload clears it and there is no lookup UI, so
a lost response cannot be searched by file — inspect data before retrying.

HTTP-mode AI chat uses the multi-agent supervisor (mock Bedrock by default).
Other pages' partial-data error rendering still needs review.

Manual checks (no automated tests; Node built-ins, no AWS):

```powershell
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run lint
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run build
```

AWS later: same client and page, with an HTTPS API base ending at the stage
(e.g. `/prod`), not `/api`. Client appends `/api` exactly once. Deployment,
packaging, CORS, Node 22 and bounded integration checks are still prerequisites;

switching variables alone does not verify them. AWS requests/storage/compute/
logs may consume credits. No browser AWS credentials.

Stop both terminals with Ctrl+C.

