# Mercury — Amazon Seller Intelligence

Decision-support MVP for one demo seller and five products. Numerical forecasts, competitor metrics and pricing simulations are computed by application code, not an LLM. No automatic price changes or transactions.

## Problem

Amazon sellers in competitive categories lack a clear, evidence-based answer to the most important daily question: *what should I do with this product right now?* Raw seller data shows what happened, but not:

- how demand is trending and what demand may look like over the next 14 days,
- how the seller's price, discount and rating compare with the competitors they actually face,
- which price would trade off demand against revenue best,
- why a recommendation is made and what evidence supports it.

Tools that automate pricing remove the seller from the decision; static reports do not connect the dots. Mercury is decision-support, not autonomous pricing.

## Solution

Mercury — Amazon Seller Intelligence is a decision-support platform for one demo seller with five products in competitive categories:

- **Dashboard** — catalog overview with per-product attention status, trend, forecast direction and price position.
- **Demand analytics + 14-day forecast** — historical units with a forecast including an uncertainty band, always labeled as estimates.
- **Competitor intelligence** — deterministic min/median/avg/max, seller position and per-competitor comparison.
- **Pricing what-if simulator** — expected daily demand, estimated revenue and competitor position per scenario price.
- **AI Analyst** — a multi-agent, grounded conversational explanation of the computed evidence.

The application never changes prices or performs transactions: it produces recommendations and simulations for the seller to decide (§37).

## Architecture

```text
                     Amazon Amplify
                           │
                    React Web App (Vite)
                           │ HTTPS
                           ▼
               Amazon API Gateway (HTTP API, stage prod)
                           │
                           ▼
                  AWS Lambda (Node 22)
             handlers/api.mjs + handlers/ai.mjs
                           │
     ┌─────────────┬───────┴────────┬───────────────────┐
     ▼             ▼                ▼                   ▼
  DynamoDB         S3            Bedrock           Forecasting
 (single table:  (versioned     (multi-agent;     (deterministic
  products,       datasets,      mock client       trend+seasonality
  sales,          upload         by default:       baseline inside the
  competitors,    artifacts,     Supervisor +      Lambda, isolated
  daily analysis  ledger)        Market/           behind ForecastService;
  snapshots)                     Competitor/       SageMaker can replace
                                 Pricing agents)   it without rewrites)
```

All analysis is **on-demand**: nothing runs without a user request — no EventBridge rule, no Step Functions workflow, no schedulers. The identical handler runs locally (`backend/local/start.mjs`) with injected in-memory adapters, so offline behavior matches deployed behavior.

## AWS services

| Service | Why it exists here |
|---|---|
| Amplify | Hosts the React SPA; environment variables set `VITE_API_MODE` / `VITE_API_BASE_URL`. |
| API Gateway (HTTP API) | Public HTTPS entry point with CORS, routing every `/api/*` route to Lambda. |
| Lambda | Runs the API, deterministic analysis, forecasting and the agent system; scales to zero; least-privilege IAM policy in `infrastructure/template.yaml`. |
| DynamoDB | Single-table application state (products, sales, competitors, analysis snapshots). The `ANALYSIS#<date>` sort key makes same-day analysis idempotent. |
| S3 | Versioned datasets and upload artifacts (raw/processed/exports prefixes); large payloads never stored in DynamoDB. |
| Bedrock | Interpretation and synthesis only, inside the agent system. In development the mock client is the default — no AWS calls or credits. |
| SageMaker (future) | `ForecastService` is isolated so a hosted model can replace the baseline without rewriting callers. |

## AI architecture

- **Supervisor agent** — routes the seller's question, calls specialist agents, merges their structured findings and produces the grounded answer with confidence, data sources and suggested follow-ups.
- **Market analyst agent** — demand trend and change, recent history, seasonality signals.
- **Competitor analyst agent** — competitor prices, discounts, ratings and the seller's position vs the median.
- **Pricing analyst agent** — interprets scenario outputs and forecast-based trade-offs.
- **Forecasting model** — NOT an agent and NOT an LLM: a deterministic trend + seasonality baseline producing expected/lower/upper per day, isolated behind `ForecastService`.

Agents return structured JSON (findings + summary) and only interpret the deterministic analysis context passed to them — they never calculate numbers.

## Data flow

On-demand only (implemented):

```text
User opens a product / asks the AI Analyst / POST /analyze
  → Lambda loads product, sales, latest competitors
  → guarded deterministic compute (competitor metrics, demand,
    forecast, pricing scenarios, recommendation)
  → save snapshot keyed PK PRODUCT#<id>, SK ANALYSIS#<YYYY-MM-DD>
  → respond; same-day repeats return the cached snapshot (idempotent)
```

Scheduled processing (EventBridge → Step Functions, §18) is deliberately **not** built: analysis runs only on request. That path remains a documented future extension requiring no changes to the existing handlers.

## ML vs GenAI

The LLM is never the source of truth for numbers. Prices, demand, forecasts, competitor statistics and percentages come from deterministic application code and the forecasting baseline, stored with the data. Bedrock (or its mock) only interprets, compares and explains, citing field names from the computed context. When data is insufficient, the response says so explicitly (`missing_data`) rather than inventing values.

## Failure handling

- **Partial page load** — product pages read sales/competitors/forecast/analysis independently; a failed read marks that section unavailable and offers a reload without destroying the page.
- **Forecast unavailable** — guarded inputs return 422 with reasons; the UI shows an amber "Forecast unavailable" notice while history and competitor analysis remain usable.
- **Bedrock failure** — AI requests fail gracefully; all numeric analysis stays available on the dashboard.
- **Duplicate/retried analysis** — `POST /analyze` is idempotent per product per day; a timed-out write may still have succeeded, and the next request returns the stored snapshot instead of duplicating it.
- **Storage writes** — bounded retries (initial attempt + 5, full jitter) for unprocessed batch items; exhaustion surfaces structured counts, never silent data loss.
- **API errors** — validation failures return explicit 400/404/422 with reasons; unexpected failures return a generic 500 without exposing AWS internals.

## Current checkpoint

Phase 5 (Bedrock multi-agent system) is implemented. The AI Analyst uses structured specialist agents (Market, Competitor, Pricing) with a Supervisor that routes questions and synthesizes grounded responses. All numbers come from deterministic analysis - the LLM only interprets. The Bedrock SDK is loaded lazily and the mock client is the default, so no AWS calls or credits are used unless explicitly configured.

Phase 6 (on-demand analysis) is implemented: analysis runs only when the user requests it - there is NO scheduled trigger, EventBridge rule or Step Functions workflow. Snapshots are idempotent by `product_id + analysis_date`, so repeated same-day requests return the identical report.

Phase 7 (polish, no AWS) is complete: responsive layout (mobile top bar with hamburger menu, desktop sidebar unchanged), an informative Settings status page (API mode, mock-Bedrock AI mode, on-demand analysis) and the demo script below. All offline deliverables from the spec are done; only Phase 8 (deploying to AWS) remains, planned in gitignored `aws.md`.

## Deployment

Deployment uses AWS and can consume credits, so it is intentionally **not executed** during offline development. `infrastructure/template.yaml` (AWS SAM) is ready: HTTP API, DynamoDB table, versioned S3 bucket and a least-privilege Lambda wired to all nine routes. The step-by-step plan — prerequisites, build/deploy commands, the seeding decision, frontend wiring, post-deploy verification and teardown — lives in `aws.md`, which is deliberately gitignored and never committed.

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

## Demo script (3–5 minutes)

Start the backend and frontend (see Local start), then walk through:

1. **Dashboard** — `Products monitored` shows the 5 demo products and `Need attention` counts products whose deterministic recommendation is `attention`. Each card shows demand trend, 14-day forecast direction and price-vs-median badges.
2. **Product detail (Wireless Earbuds)** — open the product from the dashboard: current price, demand history chart and the 14-day forecast with its uncertainty band. The UI labels these as estimates — never guaranteed future sales.
3. **Competitor landscape** — the table lists ~5 competitors with price, discount, rating and percentage vs your price; the footer summarizes min/median/avg/max and the seller position. All computed by application code, not the LLM.
4. **Pricing what-if simulator** — click `Run scenarios` to compare ±₹100 price points with expected daily demand, estimated revenue and competitor position. Deterministic estimates from recent demand — the seller makes the final decision.
5. **On-demand analysis, no scheduler** — analysis is computed when a page opens (read-only) and persisted only via `POST /api/products/{id}/analyze`, keyed `product_id + analysis_date`: same-day repeats return the cached snapshot instead of recomputing. There is no EventBridge rule or Step Functions workflow.
6. **Grounded AI output** — AI replies show a confidence badge, data sources and missing-data notes. Prices, demand, forecasts and competitor statistics come from deterministic code and the forecasting model; Bedrock only interprets them.
7. **AI Analyst** — ask "Why should I investigate my current pricing?" and watch the agent stage indicator (Market → Competitor → Forecast → Pricing → Synthesis). The answer references the same metrics shown on the dashboard, not generic e-commerce knowledge.
8. **Architecture** — walk through Amplify → API Gateway → Lambda → DynamoDB/S3 → Bedrock + forecasting, then the on-demand flow: user request → guarded compute → idempotent save → response. API contracts are documented in `docs/`.

## Documentation (absolute workspace paths)

- `C:\Users\harshiv\Desktop\Mercury\docs\phase2-local.md` — completion scope, checks and deferred integration gates
- `C:\Users\harshiv\Desktop\Mercury\docs\frontend-local-http.md` — browser configuration and manual smoke checklist
- `C:\Users\harshiv\Desktop\Mercury\docs\local-backend.md` — loopback server
- `C:\Users\harshiv\Desktop\Mercury\docs\product-api.md` — product/pricing contracts
- `C:\Users\harshiv\Desktop\Mercury\docs\analysis-api.md` — analysis snapshots
- `C:\Users\harshiv\Desktop\Mercury\docs\ingestion-api.md` — upload stages and outcomes
- `C:\Users\harshiv\Desktop\Mercury\docs\dynamodb-adapter.md` — keys, pagination and bounded retries

AWS usage is account-dependent and can consume credits even with a zero bill. Existing S3/DynamoDB/log storage can accrue usage while local development proceeds. No cleanup or destructive commands are part of local validation.

