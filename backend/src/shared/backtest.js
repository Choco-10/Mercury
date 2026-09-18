/** Backtesting helpers for chronological forecast evaluation.
 *
 * These run offline and are not used in live request paths.
 * They measure historical accuracy and interval coverage for a provider.
 */

/** Evaluate a provider's 1-step-ahead forecasts chronologically.
 *
 * For each origin i (from minHistory to n-1), predict day i+1 using
 * observations up to and including day i, then compare to actual.
 *
 * @param {Array<{date: string, units_sold: number}>} series - chronological observations
 * @param {function} predict - async (request) => { forecast: Array<{date, expected}> }
 * @returns {Promise<{ errors: Array<{origin, targetDate, predicted, actual, ae, pct_error}>, summary: {mae, mape, n} }>}
 */
export async function backtestOneStep(series, predict) {
  const errors = []
  const minHistory = 28
  for (let origin = minHistory; origin < series.length - 1; origin++) {
    const history = series.slice(0, origin + 1)
    const target = series[origin + 1]
    const request = {
      product_id: 'eval',
      horizon_days: 1,
      training_cutoff: history[history.length - 1].date,
      dates: history.map(r => r.date),
      units: history.map(r => r.units_sold),
      forecast_dates: [target.date],
    }
    const result = await predict(request)
    if (!result?.forecast?.[0]?.expected) continue
    const predicted = result.forecast[0].expected
    const actual = target.units_sold
    const ae = Math.abs(predicted - actual)
    const pctError = actual > 0 ? ae / actual : null
    errors.push({
      origin: history[history.length - 1].date,
      targetDate: target.date,
      predicted,
      actual,
      ae,
      pct_error: pctError,
    })
  }
  const n = errors.length
  const mae = n > 0 ? errors.reduce((s, e) => s + e.ae, 0) / n : null
  const validPct = errors.filter(e => e.pct_error !== null)
  const mape = validPct.length > 0
    ? validPct.reduce((s, e) => s + e.pct_error, 0) / validPct.length * 100
    : null
  return { errors, summary: { mae, mape, n } }
}

/** Evaluate interval coverage for a provider.
 *
 * Measures what fraction of actuals fall within the predicted interval.
 *
 * @param {Array<{date: string, units_sold: number}>} series
 * @param {function} predict - async (request) => { forecast: Array<{date, expected, lower, upper}> }
 * @returns {Promise<{ coverage: number, within: number, total: number, details: Array }>}
 */
export async function evaluateIntervalCoverage(series, predict) {
  const minHistory = 28
  let within = 0
  let total = 0
  const details = []
  for (let origin = minHistory; origin < series.length - 1; origin++) {
    const history = series.slice(0, origin + 1)
    const target = series[origin + 1]
    const request = {
      product_id: 'eval',
      horizon_days: 1,
      training_cutoff: history[history.length - 1].date,
      dates: history.map(r => r.date),
      units: history.map(r => r.units_sold),
      forecast_dates: [target.date],
    }
    const result = await predict(request)
    if (!result?.forecast?.[0]) continue
    const f = result.forecast[0]
    const actual = target.units_sold
    total++
    const withinInterval = actual >= f.lower && actual <= f.upper
    if (withinInterval) within++
    details.push({
      origin: history[history.length - 1].date,
      targetDate: target.date,
      predicted: f.expected,
      lower: f.lower,
      upper: f.upper,
      actual,
      within: withinInterval,
    })
  }
  return {
    coverage: total > 0 ? within / total : null,
    within,
    total,
    details,
  }
}