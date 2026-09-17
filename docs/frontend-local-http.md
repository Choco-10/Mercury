# Frontend local HTTP development

Three explicit modes:
- `local` (default): browser demo calculations; uploads disabled, never pretends to ingest.
- `localhost`: the real backend router over loopback HTTP, in-memory storage. No AWS fallback.
- `aws`: the same HTTP client over HTTPS. Not enabled or integration-verified yet.

PowerShell, terminal 1:

```powershell
node "C:\Users\harshiv\Desktop\Mercury\backend\local\start.mjs"
```

Terminal 2 (process environment overrides Vite .env files; no saved configuration changes):

```powershell
$env:VITE_API_MODE = "localhost"
$env:VITE_API_BASE_URL = "http://127.0.0.1:3001"
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open http://127.0.0.1:5173/data. Download the sales template, adjust units, and select the file. Expect a confirmed outcome with acknowledged rows, artifact statuses and analysis outcomes. Open the linked product to fetch the new analytics. Template uploads replace any existing row on that date; they do not create a product. Try an invalid date: validation issues should appear with no dataset write.

The Data page no longer has a separate naive CSV parser: the backend is authoritative. The browser checks file size before reading. While processing, both upload inputs are disabled. No automatic upload retries or polling. Read-only outcome lookup can show stale/in-progress checkpoints after interruption. A lost response without an upload ID cannot currently be searched by file; inspect data before retrying.

Browser demo uploads are intentionally disabled; use localhost for ingestion. Local storage resets on backend restart. HTTP-mode AI chat currently returns the backend placeholder, not a working Bedrock system. Other pages' partial-data error rendering still needs review.

Tests (Node built-ins, no AWS):

```powershell
node --test "C:\Users\harshiv\Desktop\Mercury\frontend\scripts\http.test.mjs"
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run lint
npm --prefix "C:\Users\harshiv\Desktop\Mercury\frontend" run build
```

AWS later: same client and page, with an HTTPS API base ending at the stage (e.g. `/prod`), not `/api`. Client appends `/api` exactly once. Deployment, packaging, CORS, Node 22 and bounded integration checks are still prerequisites; switching variables alone does not verify them. AWS requests/storage/compute/logs may consume credits. No browser AWS credentials.

Stop both terminals with Ctrl+C. To restore browser demo in terminal 2:

```powershell
$env:VITE_API_MODE = "local"
$env:VITE_API_BASE_URL = ""
```
