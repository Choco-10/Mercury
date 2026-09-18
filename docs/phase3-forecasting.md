# Phase 3 — preparation and forecasting boundary slices

Canonical module: `C:\Users\harshiv\Desktop\Mercury\shared\series.js`.
Packaged copy: `C:\Users\harshiv\Desktop\Mercury\backend\src\shared\series.js`.
Edit the canonical source only; run the shared synchronization script.

## Implemented scope

Pure preparation, UTC date helpers, and an injected asynchronous forecasting
boundary are implemented. No numerical provider, model selection, interval
calibration or endpoint wiring is included. Existing API and pricing behavior
remain unchanged. This is not Phase 3 completion.

`prepareDailySeries(rows, { minimum = 28, expectedProductId = null, today = null })`
returns `{ ok, reason, issues, series }`. Invalid options throw TypeError; invalid
source data returns a diagnostic envelope. Record count is checked before row
validation, preserving explicit precedence for short histories.

- Dates must be real YYYY-MM-DD dates (four-digit years). Timestamp compatibility
  belongs in loaders; this module rejects even midnight timestamp strings.
- Rows are copied and sorted. Output records include only date and units_sold.
- Duplicate dates are rejected, never summed. Units must be nonnegative safe
  integers; observed totals must also remain within safe integer precision.
  This does not guarantee future regression, interval or revenue arithmetic is
  safe: those layers still need their own numerical checks.
- Zero is an observed sale count, not a gap. Intermittent sales are retained.
- Missing days are counted exactly and sampled chronologically (at most 500 dates).
  No zero filling, imputation, truncation of history or data fabrication occurs.
- Default preparation requires 28 records. A lower explicit minimum supports
  diagnostics/tests; it does not lower the 28-consecutive-day eligibility flag.
- `ok: true` means preparation succeeded, NOT that a forecast is available.
  Gapped histories can be inspected, but `flags.meetsMinimumHistory` is false.
  The future forecasting service must enforce complete daily coverage. Four weeks
  is provisional eligibility, not proof of seasonality or adequate calibration.
- `today`, if supplied, is an explicit UTC date. Age is signed: negative means
  future-dated history. Without today, age and futureDated are null (unknown).
  Preparation does not move the forecast origin or reject stale histories.
  The proposed service origin remains the last observation, with dates/age shown;
  a stale window must not be advertised as the next two weeks from today.
- Sales observations are not unconstrained demand. Historical stockouts and lost
  sales cannot be reconstructed from the current inventory field. No stockout
  adjustment or claim of causal pricing effects is made.

## Validation scope

Direct Node tests cover calendar boundaries, gap sampling, timezone subprocesses,
short/zero/intermittent/constant/trending/weekly observations, bad data, unsafe
totals, sorting/nonmutation, staleness and reproducibility. Pattern tests verify
preservation of inputs, not forecasting performance. Shared drift checks cover
all shared modules. The isolated package probe imports the new modules using only the
copied Lambda sources, alongside existing fake-SDK production wiring checks.

## Next slices and deferred work

Implement/evaluate a numerical provider, then wire all consumers through the
boundary; isolate forecast failures from historical/competitor analysis; evaluate
uncertainty chronologically; then update view models and UI labels.

**Completed in this phase:**
- Numerical baseline provider: trend+weekly-seasonality with uncalibrated 80% interval
- Chronological backtesting framework (`shared/backtest.js`): 1-step-ahead MAE/MAPE and interval coverage evaluation
- Provider evaluation script (`backend/scripts/evaluate-provider.mjs`): runs against demo data
- Baseline evaluation results: MAE 1.7–5.5 units/day, MAPE 8–15%, coverage 76–91% across 5 demo products
- UI metadata display: forecast card shows model name, training summary, and origin date
- Forecast unavailability handling: shows reason code with historical/competitor analysis preserved

No offline forecast accuracy or coverage results exist yet for Phase 3.

AWS forecasting integration remains deferred. Manual browser acceptance, cloud
readiness/security/cost review, upload consistency/reconciliation, pricing model
review, Bedrock, scheduled workflows and hosting remain outside this slice.
