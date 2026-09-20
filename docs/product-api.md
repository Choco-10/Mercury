# Product API contracts — local Phase 2 checkpoint

All errors contain a public `error` string. Analysis source-data errors also
include `issues`. Unexpected storage/calculation errors return generic 500;
internal diagnostics are logged server-side, not returned.

## GET routes

- `/api/products`: product array, including `[]` for an empty catalog.
- `/api/products/{id}`: product object; missing product returns 404.
- `/api/products/{id}/sales`: stored sales array, including `[]`.
- `/api/products/{id}/competitors`: latest competitor array, including `[]`.
- `/api/products/{id}/forecast`: product_id, model, generated_at, horizon_days,
  forecast. Missing/invalid forecast inputs return 200 with model null and an
  empty forecast, preserving metadata. Storage failures still return 500.
- `/api/products/{id}/analysis`: read-only guarded computation. Insufficient or
  invalid inputs return 422, not misleading metrics. Successful shape unchanged.

Every product-specific route checks product existence first. Sales and forecast
no longer read competitors; competitor reads no longer depend on sales. Unknown
methods/subroutes return 404 and do not read storage.

## Forecast availability diagnostics — first Phase 3 slice

The backend forecast envelope additionally includes `status` and `reason`:

- Success: `status: "available"`, `reason: null`, existing model label and predictions.
  All-zero expected sales are a valid available forecast.
- Unavailable: `status: "unavailable"`, `model: null`, `forecast: []`.
  `reason` is a controlled public code, never an internal exception message:
  - `insufficient_history`: an array with fewer than three records.
  - `invalid_sales_data`: non-array input, or invalid records in an array meeting
    that minimum (dates, duplicates, units or mismatched product IDs).
  - `calculation_failed`: an unexpected validation/computation exception.

The existing validation order checks record count before individual records.
HTTP 200 and legacy envelope fields are unchanged; storage failures remain 500.
These additions currently apply to the backend forecast endpoint only, not browser
demo envelopes or analysis summaries. No forecasting-service extraction, new data
policy, model evaluation, calibration or graceful analysis degradation is included
in this slice. Three records is still only the old computational minimum. Zero
history still uses the existing interval fallback; availability is not a claim of
statistical reliability. Pricing behavior is unchanged.


## Create product

POST `/api/products` creates a product (both local loopback server and Lambda):

- Required JSON fields: `product_id` (1–64 chars, letters/digits/underscore/hyphen),
  `title` (1–200 chars), `category` (1–100 chars), `price` (positive finite number).
- Optional: `subcategory` (1–100 chars), `discount` (0–100), `rating` (0–5),
  `inventory` (nonnegative integer). Omitted optionals default to 0; blank
  `subcategory` is omitted from the stored record. Text fields are trimmed.
- Success: 201 with the stored product including a server-generated `created_at`.
- Errors before any write: 400 for malformed/non-object JSON or invalid fields,
  409 when `product_id` already exists. Adapters without `putProduct` return 501.
- Creation does not require sales or competitor data. Analysis until both CSV
  uploads exist returns 422 (`AnalysisDataError`), which is the documented
  on-demand analysis contract.

## Update product

PUT `/api/products/{id}` applies a **partial merge** — send only the fields you
want to change; everything else keeps its stored value:

- Updatable: `title`, `category`, `subcategory`, `price`, `discount`, `rating`,
  `inventory`. Same bounds as create, applied only to the fields supplied.
- `subcategory: ""` (or whitespace) clears the field; omitting it keeps it.
- `product_id` is **immutable** — it is the storage key, and renaming would orphan
  every sales/competitor/analysis row. Echoing the same value is allowed; any
  other value returns 400. Unknown body fields return 400.
- `created_at` is preserved and `updated_at` is stamped on success (200).
- Unknown product returns 404. Adapters without `putProduct` return 501.
- On success the product's same-day analysis snapshots are invalidated so the next
  read recomputes instead of serving a report built from the previous values
  (`deleteAnalysis` is optional: adapters without it skip invalidation).

## Delete product

DELETE `/api/products/{id}` removes the product **and cascades** to its sales,
competitor observations and analysis snapshots — otherwise recreating the same id
would resurrect the old rows. Returns 200 `{ deleted: true, product_id }`,
404 for an unknown product, and 501 for adapters without `deleteProduct`.
The request carries no body.

Cascade is **not atomic** and there is no confirmation step in the API. On
DynamoDB the children are queried and batch-deleted first, so a failure mid-way
leaves the product visible with degraded data and the delete safe to retry. A
product with hundreds of rows may exceed the Lambda timeout; a production design
would move this to an asynchronous delete job.

## Pricing

POST `/api/products/{id}/simulate-price` accepts an optional JSON body
`{ "objective": "increase_sales" | "maximize_revenue" }`. The backend derives
the seven contract candidate prices from the current product price, runs each
through the SageMaker endpoint (or the local endpoint double in offline mode),
computes predicted revenue in application code, and returns the objective-optimal
pick. The previous `scenario_prices` request field is no longer accepted. Invalid
or missing request body returns 400.

A valid baseline requires a positive finite product price and seller history that
satisfies the contract minimum history requirement; unique YYYY-MM-DD dates and
nonnegative safe-integer units are required. Missing or invalid baseline data
returns 422. Endpoint invocation failures return 502; a missing or unconfigured
endpoint returns 503.

Success shape:
```json
{
  "product_id": "p...",
  "objective": "maximize_revenue",
  "current_price": 1200,
  "inference_date": "2024-01-15",
  "recommended_price": 1100,
  "predicted_units": 18.5,
  "predicted_revenue": 20350.0,
  "reasoning": "Pricing simulation ran the seven candidate prices through the model and selected the objective-optimal candidate; no Bedrock agent review was performed.",
  "competitor_comparison": null,
  "confidence": "low",
  "candidates": [
    { "price": 1100, "predicted_units": 18.5, "predicted_revenue": 20350.0, "price_change_percent": -8.33 }
  ],
  "missing_data": ["no_bedrock_agent_review"]
}


## Upload contract

See `C:\Users\harshiv\Desktop\Mercury\docs\ingestion-api.md` for strict CSV validation,
product checks, artifact storage, dataset writes, analysis and ledger outcomes.
Malformed JSON and invalid envelope fields return 400 before storage access.

## Verification scope

Localhost and Lambda use the same router/calculations. The frontend HTTP client
is shared for localhost/AWS; Product Detail keeps optional data failures separate,
and catalog pages preserve products whose analyses are unavailable. There is no
browser-demo path: the frontend HTTP client parity tests run against the real
loopback backend.
Forecast date regularity, interval calibration and model refinements remain later
phase work. AWS integration has not been executed for this code checkpoint.

