# Mercury: Amazon Seller Intelligence

Mercury is a decision support web app for Amazon sellers. For every product in the catalog it answers one question: what should I do with this product right now? It computes the evidence from the seller's own data, explains it, and the seller makes the final call. It never changes prices or places orders on its own.

**Live demo:** <https://main.d1hc3m1a6gllmo.amplifyapp.com/>

## Who it is for

Individual sellers or small teams selling on Amazon who upload their own sales history and competitor prices, and want evidence based pricing and demand guidance without handing control to an automatic repricer.

## What it does

- **Catalog** - starts empty. Products are created in the UI, sales and competitor observations arrive through CSV upload. Product edit and delete are supported; delete also removes the product's history.
- **Dashboard** - catalog overview with attention status, trend, forecast direction and price position per product.
- **Demand forecast** - a 14 day forecast with an uncertainty band from a deterministic trend and weekly seasonality model. Products with less than 28 days of complete history show `insufficient_data` instead of a forecast.
- **Competitor intelligence** - min, median, average and max of uploaded competitor prices, the seller's position against them, and a per competitor comparison.
- **Pricing what-if simulator** - seven candidate prices around the current price, each scored by an XGBoost model, with predicted units, predicted revenue and competitor position per candidate.
- **Pricing recommendation** - the seller picks an objective, `increase_sales` or `maximize_revenue`. Bedrock agents review the model scenarios together with competitor data and must recommend one of the seven candidates. The backend rejects any other price.
- **AI Analyst** - a chat that answers questions about a product using a multi agent system grounded in the computed analysis. It shows a confidence level, the data sources used and missing data notes.

## Architecture

The frontend is a React SPA (Vite + React 19 + Tailwind) hosted on [AWS Amplify](https://main.d1hc3m1a6gllmo.amplifyapp.com/) at `https://main.d1hc3m1a6gllmo.amplifyapp.com/`. It talks over HTTPS to an API Gateway HTTP API that routes every `/api/*` path to one Lambda function. Behind the Lambda:

```text
                     Amazon Amplify
                           |
                    React Web App (Vite)
                           | HTTPS
                           v
               Amazon API Gateway (HTTP API)
                           |
                           v
                  AWS Lambda (Node 22)
              handlers/api.mjs + handlers/ai.mjs
                           |
     +-------------+-------+--------+-------------------+
     v             v                v                   v
   DynamoDB        S3              Bedrock            SageMaker XGBoost
 (single table:  (versioned     (Amazon Nova       (serverless endpoint
  products,       datasets and   Lite, four         pricing-xgboost-endpoint
  sales,          upload         agents:            scoring the 7 pricing
  competitors,    artifacts,     Supervisor +       candidates)
  analysis        ledger)        Market, Competitor
  snapshots)                     and Pricing)
```

All analysis is on demand. Nothing runs without a user request. There is no scheduler, no EventBridge rule and no Step Functions workflow. Snapshots are saved keyed by product and analysis date, so repeated requests on the same day return the stored snapshot instead of recomputing.

## AWS services

| Service | Role |
|---|---|
| Amplify | Hosts the React frontend. |
| API Gateway (HTTP API) | Public HTTPS entry point with CORS, routing `/api/*` to Lambda. |
| Lambda | Runs the API: product catalog, CSV ingestion, deterministic analysis, forecasting, the pricing workflow and the agent system. |
| DynamoDB | Single table state: products, sales, competitors and analysis snapshots. Same day analysis is idempotent by the `ANALYSIS#<date>` sort key. |
| S3 | Versioned datasets, model artifact and upload artifacts. |
| Bedrock | Amazon Nova Lite (set through `BEDROCK_MODEL_ID`). Used for interpretation and synthesis only. The agents never calculate numbers; they only explain what the deterministic code and the XGBoost model produced. |
| SageMaker | XGBoost pricing model on the serverless endpoint `pricing-xgboost-endpoint`. Seven candidate prices in, predicted units out. Revenue is computed in application code. |

## Agents

- **Supervisor** routes the question, calls the specialists and writes the final grounded answer.
- **Market analyst** reads demand trend, recent history and seasonality signals.
- **Competitor analyst** reads competitor prices, discounts and the seller's position.
- **Pricing analyst** reads the XGBoost scenario outputs and picks the recommendation from the seven candidates only.

Agents return structured findings. The context they see comes from deterministic analysis code and the trained model. When data is missing the response says so (`missing_data`) instead of inventing values.

## ML pricing pipeline

One dataset, one model, one endpoint. The model is never retrained on seller uploads, and competitor data never reaches XGBoost, it goes only to the Bedrock agents as context.

1. `preprocessing/prepare_m5.py` builds the training data from the M5 dataset: three years of history, around 500 products, engineered features (rolling averages, price change, day of week, month, event flags) and a chronological train/validation/test split.
2. `training/train_xgboost.py` trains the XGBoost regressor, evaluates it and publishes the artifact to S3.
3. `inference/feature_engineering.py` and `price_simulator.py` are the reference implementations of what the Lambda does at request time: compute the latest inference features from the seller history, generate exactly seven candidate prices (the current price plus or minus 10, 7.5, 5 and 2.5 percent, plus 2.5 and 5 percent), invoke the endpoint once per candidate and compute `price x predicted_units` in application code.
4. The Lambda workflow in `backend/src/services/pricing/` runs the same steps and adds the Bedrock agent review, with hard validation that the recommended price is one of the seven candidates.

## Data flow

```text
User opens a product, asks the AI Analyst, or POST /analyze
  -> Lambda loads product, sales and latest competitors
  -> deterministic compute: competitor metrics, demand,
     forecast, pricing scenarios, recommendation
  -> snapshot saved as PRODUCT#<id> / ANALYSIS#<YYYY-MM-DD>
  -> response; same day repeats return the cached snapshot
```

## Failure handling

- Product pages load sales, competitors, forecast and analysis independently, so one failed read does not break the page.
- A guarded forecast that cannot run returns 422 with a reason, and the UI keeps the history and competitor sections usable.
- AI requests fail gracefully. The numeric analysis stays available.
- Storage writes use bounded retries for unprocessed batch items. Exhaustion surfaces structured counts, never silent data loss.
- Validation failures return explicit 400, 404 or 422 with reasons. Unexpected failures return a generic 500.

