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

## Pricing

POST `/api/products/{id}/simulate-price` accepts `scenario_prices`: 1–25 positive
finite numbers. The 25-scenario cap is an application workload bound, not a
statistical or marketplace limit. Invalid request inputs return 400.

A valid baseline requires positive finite product price and at least one valid
sales record; unique YYYY-MM-DD dates and nonnegative safe-integer units are
required. History is sorted without changing source records. All-zero recent
history returns 422 instead of activating the old one-unit fallback. Missing or
invalid baseline data returns 422. Unsafe scenario arithmetic returns 400 rather
than serializing non-finite numbers as null or reporting unsafe integer outputs.

Success shape stays product_id, baseline_price, scenarios. The existing assumed
elasticity (1.4), 21-record baseline, daily estimates and baseline-relative
competitor_position labels are unchanged. This is not model validation.

## Upload contract

See `C:\Users\harshiv\Desktop\Mercury\docs\ingestion-api.md` for strict CSV validation,
product checks, artifact storage, dataset writes, analysis and ledger outcomes.
Malformed JSON and invalid envelope fields return 400 before storage access.

## Verification scope

Localhost and Lambda use the same router/calculations. The frontend HTTP client
is shared for localhost/AWS; Product Detail keeps optional data failures separate,
and catalog pages preserve products whose analyses are unavailable. Browser demo
has representative five-product success parity tests, not full error parity.
Forecast date regularity, interval calibration and model refinements remain later
phase work. AWS integration has not been executed for this code checkpoint.

