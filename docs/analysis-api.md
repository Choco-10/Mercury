# Analysis API — Phase 6 local implementation

## POST /api/products/{id}/analyze

Accepts no body or `{}` (including HTTP API v2 base64 encoding). Other
properties/body shapes are rejected; clients cannot supply computed numbers.
Loads the product, sales and latest competitors, computes deterministic analysis,
then saves a snapshot. Returns 200 only after the write is acknowledged.

**Same-day idempotency (on-demand, no scheduler):** analysis runs only when the
user requests it. Before computing, the route reads the stored snapshot keyed by
`product_id + analysis_date` (UTC calendar date of `generated_at`). If a
same-day snapshot exists it is returned as-is — repeated requests on the same
day return the identical report instead of recomputing. The next calendar day
computes and overwrites the date key with a fresh snapshot.

The response is the analysis object plus `analysis_id` (UUID):
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
- SK: `ANALYSIS#<analysis_date YYYY-MM-DD>` (one snapshot per product per day)
- data: complete returned snapshot

The date key makes same-day writes idempotent: a retry or a repeated user
request overwrites the same key with an equivalent report instead of creating
duplicates. Analysis is always user-triggered; there is no scheduled trigger,
EventBridge rule or Step Functions workflow. A timed-out write can have
succeeded remotely, so a 500 is not proof that nothing was stored — the next
request returns the stored snapshot.

## GET /api/products/{id}/analysis

GET computes on demand and does not write or retrieve saved snapshots.
It does not include analysis_id. No snapshot-list/latest-read endpoint is added.
GET and POST share guarded computation: both return 422 for insufficient or
invalid source data and a generic 500 for unexpected calculation failures.
Their successful calculation fields remain identical.

## Offline validation

Run in PowerShell:

```powershell
node --test "C:\Users\harshiv\Desktop\Mercury\backend\tests\simulate-price.test.mjs" "C:\Users\harshiv\Desktop\Mercury\backend\tests\analyze.test.mjs"
```

Router tests use in-memory storage. Writer/reader tests use the actual SDK
PutCommand/GetCommand with an injected fake send method: no AWS client,
credentials or network requests.
Offline tests do not prove AWS integration.
