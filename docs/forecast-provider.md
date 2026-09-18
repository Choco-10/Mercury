# Forecast provider contract — local boundary, not an AWS adapter

Canonical service: `C:\Users\harshiv\Desktop\Mercury\shared\forecast-service.js`.
Packaged copy: `C:\Users\harshiv\Desktop\Mercury\backend\src\shared\forecast-service.js`.
Sync through `C:\Users\harshiv\Desktop\Mercury\backend\scripts\sync-shared.mjs`.

## Construction and responsibilities

`createForecastService({ loadSales, provider, now })` returns an object with
`async predict(productId, { horizon = 14, loadSales } = {})`. An optional per-call
`loadSales` function overrides the constructor loader for that call only, allowing
already-read observations to be supplied without another storage read. Non-function
overrides throw TypeError.

- `loadSales(productId)` returns normalized observations, or a promise for them.
  Normalize legacy timestamps in the loader, not by relaxing validation. Product
  existence/HTTP 404 belongs to route orchestration. One predict call loads once.
  Analysis can inject a loader over its already-read observations to avoid a
  second, inconsistent storage read. No persistence occurs in this service.
- `now()` returns a valid Date; defaults to the current clock. The service captures
  generated_at once before loading. Inject a fixed clock for reproducible tests.
- `provider.predict(request)` returns a numerical result or promise. There is no
  default provider, remote client, network fallback, LLM, or SageMaker mock adapter.
- Invalid construction, product IDs, horizons other than numeric 14, or invalid
  clocks throw TypeError. Operational failures produce unavailable envelopes.

## Provider request

A frozen object containing `product_id`, `horizon_days`, `training_cutoff`, and
frozen arrays `dates`, `units`, `forecast_dates`. Dates and units are sorted copies
of validated observations. No prices, inventory, arbitrary row metadata, or future
sales are supplied. Output dates are the 14 UTC days immediately after cutoff.

Preparation enforces at least 28 observations, unique valid dates, nonnegative
safe-integer counts and a safe aggregate. Any missing calendar day makes the
forecast unavailable before provider invocation. No imputation or truncation.
Four weeks is provisional eligibility, not evidence of seasonal model reliability.

Stale and future-dated histories keep their cutoff and receive explicit warnings;
neither is silently shifted to the generation date. All data supplied by the loader
is treated as observed; this service does not implement a historical as-of query.
Backtests MUST pass only each origin's prefix through the loader. The service is
not a substitute for a leakage-safe evaluation runner.

## Provider result

Required fields:

- `model`, `model_version`: nonblank public labels, <=120 characters, no ASCII
  control characters. Providers must not place private diagnostics in labels.
- `interval: { method, nominal_level }`: public method label under the same rules;
  level is null for an unassigned/uncalibrated nominal target or a number in (0, 1).
- `forecast`: exactly 14 rows `{ date, expected, lower, upper }` matching the supplied
  dates in order, with finite nonnegative numbers and lower <= expected <= upper.
  Fractional expectations are allowed; the service never rounds or repairs output.
  Every bound and the sum of upper bounds must remain <= Number.MAX_SAFE_INTEGER.
  This is a range check, not a guarantee of exact floating-point fractional sums.

The serializer copies only these fields. Extra provider metadata is not exposed.
Malformed/sparse/partial output is rejected wholesale, never padded with zeros.
Nominal levels are provider declarations, NOT measured coverage. No empirical
coverage, calibration count or evaluation result is invented by the boundary.

## Service response

Retains `product_id`, `model`, `generated_at`, `horizon_days`, and `forecast`.
Adds `model_version`, `status`, `reason`, `forecast_origin`, `training_cutoff`,
`training_summary`, `interval`, and `warnings`.

Origin means the last training observation, not the generation timestamp. Training
summary has first_date, last_date, observed_days, span_days, missing_days and signed
age_days. Metadata survives provider failure when preparation succeeded.

Available: status available, reason null. Valid zero predictions remain available.
Unavailable: status unavailable, model/model_version/interval null, forecast [].
No totals, revenues or percentages are fabricated. Reasons are controlled codes:
`sales_load_failed`, `preparation_failed`, `insufficient_history`,
`invalid_sales_data`, `unsupported_numeric_range`, `missing_dates`,
`unsupported_date_range`, `provider_failed`, `invalid_provider_output`.

Warnings always include observed_sales_not_unconstrained_demand and
forecast_evaluation_not_verified. The latter is deliberately unconditional in this
pre-evaluation slice. Age adds history_ends_before_generation_date or
history_ends_after_generation_date. An available forecast can still be unreliable.

## Tests and limitations

Fake providers exist only in tests; they are not models. Tests exercise awaiting,
immutable requests, zero results, invalid outputs, sanitized failures, date windows,
staleness, reproducibility, packaging and unchanged consumer regressions.

Existing endpoint, browser demo, analysis and upload consumers still use the old
baseline; they DO NOT yet use this service. No model accuracy, interval coverage,
end-to-end graceful analysis degradation or browser acceptance is established.

Future remote providers need a reviewed timeout/cancellation policy, bounded retry
semantics, job lifecycle if asynchronous jobs are used, versioned model artifacts,
validated data/output schemas, payload/runtime limits, IAM/cost controls and
observability without returning private errors. This boundary awaits promises;
it does not implement remote job polling, retries, timeout or cancellation. A
provider that never settles will keep the call pending. No AWS integration is
implemented or enabled by this module.
