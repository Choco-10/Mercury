# CSV ingestion contract

`POST /api/data/upload` — request `{ "type": "sales" | "competitors", "csv": "<text>" }`.
Request body is capped at 2 MiB before parsing (HTTP 413).
After validation, production code stores raw CSV and normalized JSON using S3;
offline tests use fake S3 transports or explicitly injected in-memory adapters.

## Schemas (headers may be reordered; extra/missing columns are rejected)

```text
sales:        date,product_id,price,units_sold,discount
competitors:  date,competitor_id,product_id,competitor_product_id,competitor_price,competitor_discount
```

## Validation (whole file first; invalid files cause no writes)

- RFC 4180-style parsing: quoted fields, escaped `""` quotes, embedded commas/newlines, BOM, CRLF.
- Dates must be real calendar `YYYY-MM-DD`.
- Numbers: plain nonnegative decimals; `price > 0` and `competitor_price > 0`; `units_sold` a safe integer; `discount` and `competitor_discount` ≤ 100.
- IDs: `product_id`, `competitor_id` and `competitor_product_id` are 1–64 chars of `A–Z a–z 0–9 _ -`.
- Duplicate natural keys **within one file** are rejected: sales `(product_id, date)`;
  competitors `(product_id, competitor_id, date)`.
- Every `product_id` must exist in the product catalog.
- Limits: ≤ 256 KiB of CSV, ≤ 2000 data records, ≤ 50 reported issues (HTTP 422 `issues`; 413 when over limits).

Valid uploads still **replace** existing records sharing the same natural key.

## Success (200)

```json
{ "status": "accepted", "rows": 3, "upload_id": "<uuid>", "acknowledged_rows": 3, "uncertain_rows": 0, "not_attempted_rows": 0 }
```

`acknowledged_rows` counts only records for which the storage write returned without error.
Returned after artifact, dataset, analysis-outcome, and final ledger writes are acknowledged.
`status` is `accepted` when all analyses completed, or `accepted_with_analysis_warnings`
when the dataset was stored but some analyses were unavailable, failed, or had an
uncertain snapshot-save outcome. The `analysis` array reports each product separately.
Do not retry the entire upload merely because analysis is unavailable.

## Pipeline and outcome lookup

1. Normalize the whole CSV and validate all product IDs; invalid input performs no writes.
2. Create a ledger record, then save exact raw CSV (`text/csv; charset=utf-8`) and
   normalized JSON (`application/json`) at `uploads/<upload_id>/raw.csv` and `normalized.json`.
3. Write datasets by product, with ledger checkpoints before and after each operation.
4. Read current sales/competitors, compute deterministic analysis, and save snapshots.
5. Acknowledge the final ledger outcome before reporting success.

`GET /api/data/uploads/<upload_id>` returns the last acknowledged outcome (200),
400 for an invalid UUID, or 404 if no record exists. It does not expose download URLs
or offer a list of uploads. A UUID is not authentication: this demo API remains public.
The Data page no longer surfaces this lookup — the outcome is shown once, immediately
after an upload — so the route is currently API-only.
DynamoDB key: `PK=SELLER#SELLER001`, `SK=UPLOAD#<uuid>`. Create requires nonexistence;
updates require existence. One invocation owns each generated ID; no concurrent resume.

Ledger and S3 operations use injected adapters. The memory adapter is ephemeral;
only the production DynamoDB ledger is durable. Production wiring is not cloud-verified.

## Incomplete write (500) — not a generic error

```json
{ "status": "incomplete", "error": "Upload did not complete; some rows may have been written. Review before retrying.",
  "upload_id": "<uuid>", "rows": 3, "acknowledged_rows": 1, "uncertain_rows": 1, "not_attempted_rows": 1,
  "failed_product_id": "P002", "partial_writes_possible": true }
```

DynamoDB writes are **not atomic**: an SDK error may follow an acknowledged or timed-out partial write, so
`uncertain_rows` may have been persisted or not. Earlier groups keep their writes; later groups are not attempted.
There is no whole-upload auto-retry or compensating delete. SDK retries and bounded
unprocessed batch-write retries still apply. Ledger failure stops subsequent stages and
returns 500 with `ledger_acknowledged: false`, never unqualified success.
The last saved checkpoint may remain `in_progress` after a crash or timeout. Treat it as
unresolved, not proof of success or failure. Before-operation checkpoints conservatively
mark rows/artifacts uncertain; an operation may not yet have been attempted. If the
HTTP response or initial ledger create fails, the client may not receive an upload ID.
Artifact states are `not_attempted`, `uncertain`, or `stored`; no cleanup is automatic.

## Known limitations

- No idempotency keys, automatic resume, reconciliation, retention policy, or orphan cleanup.
- Synchronous processing can exceed the 30-second Lambda timeout; local tests do not validate cloud latency.
- Sales/competitor base-table reads are strongly consistent, but multiple queries/pages are not one snapshot;
  concurrent uploads can affect analysis. Strong reads consume more DynamoDB read capacity when deployed.
- The existing forecast's three-day minimum is computational only. Its weekday fallback can distort
  short-history forecasts (three constant 10-unit days yield 142 units over 14 days, not 140).
- Browser Data-page wiring, deployable SDK packaging/lockfile and Node 22 verification remain pending.
- Invalid CSV/unknown-product rejections deliberately have no stored artifacts or ledger entries.
- `getCompetitorsLatest` still scans full competitor history; no latest-observation index (would add its own
  partial-write consistency problem during uploads).
