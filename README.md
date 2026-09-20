# Mercury — Amazon Seller Intelligence

Decision-support MVP for seller-entered catalogs. The app boots with an empty
catalog — every product is created in the UI and every observation arrives via
CSV upload. Numerical forecasts, competitor metrics and pricing simulations are
computed by application code and the XGBoost model, not an LLM. No automatic
price changes or transactions.

## Problem

Amazon sellers in competitive categories lack a clear, evidence-based answer to the most important daily question: *what should I do with this product right now?* Raw seller data shows what happened, but not:

- how demand is trending and what demand may look like over the next 14 days,
- how the seller's price, discount and rating compare with the competitors they actually face,
- which price would trade off demand against revenue best,
- why a recommendation is made and what evidence supports it.

Tools that automate pricing remove the seller from the decision; static reports do not connect the dots. Mercury is decision-support, not autonomous pricing.

## Solution

- **Dashboard** — catalog overview with per-product attention status, trend, forecast direction and price position.
- **Demand analytics + 14-day forecast** — historical units with a forecast including an uncertainty band, always labeled as estimates. Products with fewer than 28 days of complete history show `insufficient_data`, not a forecast.
- **Competitor intelligence** — deterministic min/median/avg/max, seller position and per-competitor comparison.
- **Pricing what-if simulator** — expected daily demand, estimated revenue and competitor position per scenario price.
- **XGBoost pricing recommendation** — seven candidate prices scored by the trained model, revenue computed in application code, and a Bedrock multi-agent synthesis that must recommend one of the seven candidates.
- **AI Analyst** — a multi-agent, grounded conversational explanation of the computed evidence.

The application never changes prices or performs transactions: it produces recommendations and simulations for the seller to decide.

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
   DynamoDB         S3            Bedrock           SageMaker XGBoost
 (single table:  (versioned     (real runtime      (serverless endpoint
  products,       datasets +     client: Claude 3   pricing-xgboost-endpoint
  sales,          model +        Haiku; Supervisor  for the 7 pricing
  competitors,    upload         + Market/          candidates; offline dev
  daily analysis  artifacts,     Competitor/        uses an injected double
  snapshots)      ledger)        Pricing agents)    from backend/local/)
```

All analysis is **on-demand**: nothing runs without a user request — no EventBridge rule, no Step Functions workflow, no schedulers. The identical handler runs locally (`backend/local/start.mjs`) with injected in-memory adapters, so offline behavior matches deployed behavior.

## AWS services

| Service | Why it exists here |
|---|---|
| Amplify | Hosts the React SPA; environment variables set `VITE_API_MODE` / `VITE_API_BASE_URL`. |
| API Gateway (HTTP API) | Public HTTPS entry point with CORS, routing every `/api/*` route to Lambda. |
| Lambda | Runs the API, deterministic analysis, forecasting, the pricing workflow and the agent system; least-privilege IAM in `infrastructure/template.yaml`. |
| DynamoDB | Single-table application state (products, sales, competitors, analysis snapshots). The `ANALYSIS#<date>` sort key makes same-day analysis idempotent. |
| S3 | Versioned datasets and upload artifacts (raw/processed/exports prefixes); large payloads never stored in DynamoDB. |
| Bedrock | Interpretation and synthesis only, inside the agent system. The deployed stack always calls the real runtime client (Claude 3 Haiku, token-billed); the offline dev server injects its own Bedrock double from `backend/local/`. |
| SageMaker | XGBoost pricing model on the serverless endpoint `pricing-xgboost-endpoint`: seven candidate prices → predicted units → app-side revenue. The trend+seasonality baseline behind `ForecastService` stays deterministic and does not use it. |

## AI architecture

- **Supervisor agent** — routes the seller's question, calls specialist agents, merges their structured findings and produces the grounded answer with confidence, data sources and suggested follow-ups.
- **Market analyst agent** — demand trend and change, recent history, seasonality signals.
- **Competitor analyst agent** — competitor prices, discounts and the seller's position vs the median.
- **Pricing analyst agent** — interprets XGBoost scenario outputs and forecast-based trade-offs; selects only from the seven evaluated candidate prices.
- **Forecasting model** — NOT an agent and NOT an LLM: a deterministic trend + seasonality baseline producing expected/lower/upper per day, isolated behind `ForecastService`.

Agents return structured JSON (findings + summary) and only interpret the deterministic analysis context passed to them — they never calculate numbers.

## ML pricing pipeline (training/, inference/, preprocessing/)

One dataset (M5), one model, one endpoint:

1. `preprocessing/prepare_m5.py` — 3 years of M5 history, ~500 products, engineered features (lags, rolling averages, price change, events), chronological 70/15/15 split.
2. `training/train_xgboost.py` — local dry-run first, then the SageMaker training artifact; test metrics MAE ≈ 4.34, RMSE ≈ 7.99.
3. `inference/feature_engineering.py` + `price_simulator.py` — reference implementation mirrored by the Lambda pricing workflow (`backend/src/services/pricing/`): latest inference features from seller history + stored mappings → exactly 7 candidates (P−10% … P+5%) → one XGBoost invoke per candidate → `predicted_revenue = price × predicted_units` in app code → scenarios + competitor data to Bedrock → recommended price, hard-validated to be one of the 7.

The model is never retrained on seller uploads; competitor data never reaches XGBoost (Bedrock context only). When data is insufficient the response says so explicitly (`missing_data`) rather than inventing values.

## Data flow

On-demand only:

```text
User opens a product / asks the AI Analyst / POST /analyze
  → Lambda loads product, sales, latest competitors
  → guarded deterministic compute (competitor metrics, demand,
    forecast, pricing scenarios, recommendation)
  → save snapshot keyed PK PRODUCT#<id>, SK ANALYSIS#<YYYY-MM-DD>
  → respond; same-day repeats return the cached snapshot (idempotent)
```

## Failure handling

- **Partial page load** — product pages read sales/competitors/forecast/analysis independently; a failed read marks that section unavailable and offers a reload without destroying the page.
- **Forecast unavailable** — guarded inputs return 422 with reasons; the UI shows an amber "Forecast unavailable" notice while history and competitor analysis remain usable.
- **Bedrock failure** — AI requests fail gracefully; all numeric analysis stays available on the dashboard.
- **Duplicate/retried analysis** — `POST /analyze` is idempotent per product per day; the next request returns the stored snapshot instead of duplicating it.
- **Storage writes** — bounded retries (initial attempt + 5, full jitter) for unprocessed batch items; exhaustion surfaces structured counts, never silent data loss.
- **API errors** — validation failures return explicit 400/404/422 with reasons; unexpected failures return a generic 500 without exposing AWS internals.

## Deployment

`infrastructure/template.yaml` (AWS SAM) defines the HTTP API, DynamoDB table, versioned S3 bucket and a least-privilege Lambda wired to all routes — product CRUD + subresources, simulate-price, analyze, pricing/recommend, ai/chat, upload + upload-outcome — with `sagemaker:InvokeEndpoint` scoped to the one endpoint and `bedrock:InvokeModel` scoped to Claude 3 Haiku. Deploy with `sam build && sam deploy --guided` (`samconfig.toml` is tracked). Frontend hosting: Amplify with `VITE_API_MODE=aws` and `VITE_API_BASE_URL` pointing at the deployed stage.

⚠️ AWS usage is account-dependent and can consume credits even with a zero bill.

## Local start (PowerShell)

Terminal 1:
```powershell
node backend\local\start.mjs
```

Terminal 2:
```powershell
$env:VITE_API_MODE = "localhost"
$env:VITE_API_BASE_URL = "http://127.0.0.1:3001"
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort
```
Open http://127.0.0.1:5173. The catalog starts empty: use "+ Add product" on the Products page, upload sales + competitor CSVs on the Data page, then open the product for analytics and the AI Analyst.

## Validation

```powershell
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend run check-shared
```
For fresh dependency installation use `npm ci` in backend, backend/src and frontend. The deployable manifest/lockfile lives in backend/src. Edit canonical shared math only in `shared/`, then run `node backend/scripts/sync-shared.mjs` to mirror it into `backend/src/shared/`.

## Documentation

- `docs/product-api.md` — product/pricing contracts
- `docs/analysis-api.md` — analysis snapshots
- `docs/ingestion-api.md` — upload stages and outcomes
- `docs/forecast-provider.md` — forecasting boundary and provider
- `docs/local-backend.md` — loopback server
- `docs/frontend-local-http.md` — browser configuration and manual checklist
- `docs/dynamodb-adapter.md` — keys, pagination and bounded retries
