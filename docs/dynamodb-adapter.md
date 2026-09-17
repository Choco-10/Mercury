# DynamoDB adapter — local Phase 2 checkpoint

Production `store.js` wires a DocumentClient into `createStore`. The API and
manual seed script share this adapter. Tests import the adapter and inject a fake
`send` transport; they do not create an AWS client or contact DynamoDB.

## Queries

Product listing uses the seller partition and PRODUCT# sort-key prefix. Sales
and competitors use their product partition and entity prefix. Queries follow
LastEvaluatedKey via ExclusiveStartKey, including empty intermediate pages.
Missing or empty continuation keys terminate the query. Repeated cursors or the
1000-page safety limit throw rather than returning incomplete results. Sales are
sorted by date; latest competitor observations are selected across all pages.

This still reads competitor history to determine latest observations. It is not
an optimized materialized-latest access pattern. Product listing remains eventually
consistent. Sales/competitor queries now use ConsistentRead=true so post-upload analysis
can read acknowledged writes. Strong reads use more read capacity when deployed;
pagination still does not provide a point-in-time snapshot. Large histories can
still hit Lambda time/memory limits; the page limit is not a cost budget.

## Writes

Batch writes use sequential chunks of at most 25 requests. Only the pending
UnprocessedItems subset is retried. Defaults: initial attempt plus five retries,
full jitter with 100ms exponential base and a 2000ms ceiling per wait. Tests inject
sleep/random so no real waits are necessary. SDK retryable exceptions use the
production client's explicit maxAttempts=3; application code does not add another
exception-retry loop. Thus one application send may involve multiple SDK attempts.

Exhaustion throws IncompleteBatchWriteError with counts for unprocessed items in
the current chunk, unattempted items in this call's later chunks, and attempts for
the failed chunk. Earlier writes can already have succeeded. Those counts are not
a whole-upload audit record. Transport exceptions propagate; their write outcome
may be ambiguous. No rollback or cross-item transaction is implied. API handlers
return structured incomplete outcomes for upload write failures; unrelated internal errors
remain generic 500 responses. See ingestion-api.md for CSV validation, artifact storage,
and upload ledger checkpoints. Cross-service atomicity, request idempotency, and
AWS dependency packaging are not established by this adapter.

## Seed safety

The manual seed script now shares putProduct/putSales/putCompetitors and requires
an explicit TABLE_NAME; the outdated hard-coded fallback has been removed. The
script was syntax-checked only, NOT executed. Running it writes cloud data and can
consume AWS credits. No deployment or reseeding is needed for this local step.
