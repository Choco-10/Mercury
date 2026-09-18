import test from 'node:test'
import assert from 'node:assert/strict'
import { backtestOneStep, evaluateIntervalCoverage } from '../../shared/backtest.js'
import { forecastSeries } from '../../shared/analytics.js'

// Simple provider that uses forecastSeries
function makeProvider() {
  return {
    async predict(request) {
      // forecastSeries expects dates and values separately
      // Use the training dates (history) for the model fit
      const forecast = forecastSeries(request.dates, request.units, request.horizon_days)
      // Return forecasts for the requested forecast_dates
      // forecastSeries returns horizon predictions starting after the last date
      const mapped = request.forecast_dates.map((date, i) => {
        // Find the prediction for this date
        const pred = forecast.find(f => f.date === date)
        return {
          date,
          expected: pred?.expected ?? 0,
          lower: pred?.lower ?? 0,
          upper: pred?.upper ?? 0,
        }
      })
      return { forecast: mapped }
    },
  }
}

test('backtestOneStep runs chronological evaluation', async () => {
  // Create a series with 40 days of data starting from a valid date
  const start = new Date('2026-09-01')
  const series = Array.from({ length: 40 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return {
      date: d.toISOString().slice(0, 10),
      units_sold: 10,
    }
  })
  const provider = makeProvider()
  const predict = (request) => provider.predict(request)
  const { errors, summary } = await backtestOneStep(series, predict)
  assert.ok(summary.n > 0, 'should have evaluation points')
  assert.equal(summary.mae, 0, 'perfect predictions should have zero MAE')
  assert.equal(summary.mape, 0, 'perfect predictions should have zero MAPE')
  assert.ok(errors.length > 0, 'should have error records')
})

test('backtestOneStep handles zero actuals', async () => {
  const start = new Date('2026-09-01')
  const series = Array.from({ length: 40 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return {
      date: d.toISOString().slice(0, 10),
      units_sold: i < 30 ? 10 : 0,
    }
  })
  const provider = makeProvider()
  const predict = (request) => provider.predict(request)
  const { summary } = await backtestOneStep(series, predict)
  assert.ok(summary.n > 0)
  // MAPE should be null or handle zeros
  assert.ok(summary.mape === null || typeof summary.mape === 'number')
})

test('evaluateIntervalCoverage measures coverage', async () => {
  const start = new Date('2026-09-01')
  const series = Array.from({ length: 40 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return {
      date: d.toISOString().slice(0, 10),
      units_sold: 10,
    }
  })
  const provider = makeProvider()
  const predict = (request) => provider.predict(request)
  const result = await evaluateIntervalCoverage(series, predict)
  assert.ok(result.total > 0)
  assert.equal(result.within, result.total, 'perfect predictions should all be within interval')
  assert.equal(result.coverage, 1)
  assert.ok(result.details.length > 0)
})