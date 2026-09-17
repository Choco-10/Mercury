# Analysis API — Phase 2 local implementation

## POST /api/products/{id}/analyze

Accepts no body or `{}` (including HTTP API v2 base64 encoding). Other
properties/body shapes are rejected; clients cannot supply computed numbers.
Loads the product, sales and latest competitors, computes deterministic analysis,
then saves a snapshot. Returns 200 only after the write is acknowledged.

The response is the existing GET /analysis object plus `analysis_id` (UUID):
`product_id`, `generated_at`, `competitor_metrics`, `demand`,
`forecast_summary`, `recommendation`, `analysis_id`.
No Bedrock call, external forecast service, price change or transaction occurs.

- 400: malformed JSON or unsupported request body.
- 404: missing product or unsupported route.
- 422: source data cannot support a snapshot; response includes `issues`.
- 500: unexpected calculation/read/write failure; generic public error.

Snapshot input requires a positive finite product price, at least three unique
valid daily sales records with nonnegative safe-integer units, and at least one
positive finite competitor price. Supplied product IDs must match. Sales are
sorted without mutating the source. Three records is only the current baseline
forecast's computational minimum, NOT evidence of forecast reliability. The
existing trend reports insufficient_data below 21 records. Missing calendar days
are not filled; regularity/evaluation is a later forecasting concern.

## Persistence

DynamoDB item:
- PK: `PRODUCT#<product_id>`
- SK: `ANALYSIS#<generated_at ISO timestamp>#<analysis_id UUID>`
- data: complete returned snapshot

A conditional put prevents overwriting the same snapshot key. Separate POSTs
create separate snapshots, even for identical inputs. HTTP retry deduplication
is NOT implemented. A timed-out write can have succeeded remotely, so a 500 is
not proof that nothing was stored. Retention and retry idempotency remain future
work before scheduled workflows are enabled.

## GET /api/products/{id}/analysis

GET computes on demand and does not write or retrieve saved snapshots.
It does not include analysis_id. No snapshot-list/latest-read endpoint is added.
GET and POST now share guarded computation: both return 422 for insufficient or
invalid source data and a generic 500 for unexpected calculation failures.
Their successful calculation fields remain identical.

## Offline validation

Run in PowerShell:

```powershell
node --test "C:\Users\harshiv\Desktop\Mercury\backend\tests\simulate-price.test.mjs" "C:\Users\harshiv\Desktop\Mercury\backend\tests\analyze.test.mjs"
```

Router tests use in-memory storage. Writer tests use the actual SDK PutCommand
with an injected fake send method: no AWS client, credentials or network requests.
The SDK is currently installed via the backend parent package; deployable-package
dependency packaging is still pending. Offline tests do not prove AWS integration.
