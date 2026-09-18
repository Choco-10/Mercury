import { prepareDailySeries, addDaysUTC } from './series.js'

const text = (value) => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value)

/** Copy only validated public model outputs; never serialize arbitrary provider fields. */
function serializePrediction(result, dates) {
  if (!result || !text(result.model) || !text(result.model_version) ||
      !result.interval || !text(result.interval.method) ||
      !(result.interval.nominal_level === null ||
        (Number.isFinite(result.interval.nominal_level) && result.interval.nominal_level > 0 && result.interval.nominal_level < 1)) ||
      !Array.isArray(result.forecast) || result.forecast.length !== dates.length) {
    throw new TypeError('Invalid provider envelope')
  }
  let totalUpper = 0
  const forecast = []
  // Indexed iteration also rejects sparse arrays rather than silently retaining holes.
  for (let i = 0; i < dates.length; i++) {
    const row = result.forecast[i]
    if (!row || row.date !== dates[i] ||
        ![row.lower, row.expected, row.upper].every((n) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER) ||
        row.lower > row.expected || row.expected > row.upper ||
        row.upper > Number.MAX_SAFE_INTEGER - totalUpper) {
      throw new TypeError('Invalid provider prediction')
    }
    totalUpper += row.upper
    forecast.push({ date: row.date, expected: row.expected, lower: row.lower, upper: row.upper })
  }
  return {
    model: result.model, model_version: result.model_version, forecast,
    interval: { method: result.interval.method, nominal_level: result.interval.nominal_level },
  }
}

/**
 * Async, browser-compatible boundary. No default provider or implicit AWS fallback.
 * loadSales(productId) -> Promise<normalized sales rows>.
 * provider.predict(frozen request) -> Promise<{model, model_version, interval, forecast}>.
 * now() -> Date. Invalid caller options/clock are programming errors, not data absence.
 */
export function createForecastService({ loadSales, provider, now = () => new Date() } = {}) {
  if (typeof loadSales !== 'function' || typeof provider?.predict !== 'function' || typeof now !== 'function') {
    throw new TypeError('Forecast service requires loadSales, provider.predict and a clock')
  }
  return {
    async predict(productId, { horizon = 14, loadSales: loadOverride } = {}) {
      if (typeof productId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(productId) || horizon !== 14) {
        throw new TypeError('Expected a product ID and a 14-day horizon')
      }
      if (loadOverride !== undefined && typeof loadOverride !== 'function') {
        throw new TypeError('loadSales override must be a function')
      }
      const load = loadOverride ?? loadSales
      const instant = now()
      if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new TypeError('Clock must return a valid Date')
      const generatedAt = instant.toISOString()
      const response = {
        product_id: productId, model: null, model_version: null,
        generated_at: generatedAt, horizon_days: 14, forecast: [],
        status: 'unavailable', reason: null, forecast_origin: null,
        training_cutoff: null, training_summary: null, interval: null,
        warnings: ['observed_sales_not_unconstrained_demand', 'forecast_evaluation_not_verified'],
      }
      const unavailable = (reason) => ({ ...response, reason })
      let rows
      try { rows = await load(productId) } catch { return unavailable('sales_load_failed') }
      let prepared
      try {
        prepared = prepareDailySeries(rows, { expectedProductId: productId, today: generatedAt.slice(0, 10) })
      } catch { return unavailable('preparation_failed') }
      if (!prepared.ok) return unavailable(prepared.reason)
      const series = prepared.series
      response.training_cutoff = series.lastDate
      response.forecast_origin = series.lastDate
      response.training_summary = {
        first_date: series.firstDate, last_date: series.lastDate,
        observed_days: series.observedDays, span_days: series.spanDays,
        missing_days: series.missingDays, age_days: series.stalenessDays,
      }
      if (series.stalenessDays > 0) response.warnings.push('history_ends_before_generation_date')
      if (series.futureDated) response.warnings.push('history_ends_after_generation_date')
      if (!series.flags.completeDailyCoverage) return unavailable('missing_dates')
      let dates
      try { dates = Array.from({ length: horizon }, (_, i) => addDaysUTC(series.lastDate, i + 1)) }
      catch { return unavailable('unsupported_date_range') }
      const request = Object.freeze({
        product_id: productId, horizon_days: horizon, training_cutoff: series.lastDate,
        dates: Object.freeze([...series.dates]), units: Object.freeze([...series.units]),
        forecast_dates: Object.freeze([...dates]),
      })
      let result
      try { result = await provider.predict(request) } catch { return unavailable('provider_failed') }
      try {
        const prediction = serializePrediction(result, dates)
        return { ...response, ...prediction, status: 'available', reason: null }
      } catch { return unavailable('invalid_provider_output') }
    },
  }
}
