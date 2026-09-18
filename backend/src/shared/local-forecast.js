import { forecastSeries, mean } from './analytics.js'
import { createForecastService } from './forecast-service.js'

/** Existing local numerical baseline, not a cloud adapter or evaluated model. */
export const baselineProvider = Object.freeze({
  async predict({ dates, units, horizon_days }) {
    return {
      model: 'trend+weekly-seasonality (lambda baseline)',
      model_version: 'baseline-utc-v1',
      interval: { method: 'uncalibrated residual normal approximation', nominal_level: 0.8 },
      forecast: forecastSeries(dates, units, horizon_days),
    }
  },
})

/** All consumers supply their already-read snapshot; no duplicate storage reads. */
export function predictLocalForecast(productId, sales, { provider = baselineProvider, now } = {}) {
  return createForecastService({ loadSales: async () => sales, provider, now }).predict(productId)
}

/** Summary of a validated service result. Unknown is never converted to zero. */
export function summarizeForecast(result, recentUnits) {
  const available = result.status === 'available'
  const total = available ? result.forecast.reduce((sum, row) => sum + row.expected, 0) : null
  const daily = available ? total / result.horizon_days : null
  const recent = mean(recentUnits)
  const delta = daily !== null && recent > 0 ? Math.round(((daily - recent) / recent) * 1000) / 10 : null
  return {
    horizon_days: result.horizon_days,
    status: result.status,
    reason: result.reason,
    model: result.model,
    model_version: result.model_version,
    forecast_origin: result.forecast_origin,
    training_cutoff: result.training_cutoff,
    training_summary: result.training_summary,
    interval: result.interval,
    warnings: [...result.warnings],
    expected_mean_daily: daily !== null ? Math.round(daily) : null,
    delta_vs_recent_pct: Number.isFinite(delta) ? delta : null,
    total_expected_14d: total,
  }
}
