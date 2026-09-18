#!/usr/bin/env node
/**
 * Provider evaluation script — offline analysis of forecast accuracy.
 *
 * Runs chronological backtesting against the demo dataset and reports
 * MAE, MAPE, and interval coverage. This is NOT used in live request paths.
 *
 * Usage: node backend/scripts/evaluate-provider.mjs
 */

import { getDemoDataset } from '../../frontend/src/data/demoData.js'
import { backtestOneStep, evaluateIntervalCoverage } from '../src/shared/backtest.js'
import { forecastSeries } from '../src/shared/analytics.js'

function baselineProvider(request) {
  const forecast = forecastSeries(request.dates, request.units, request.horizon_days)
  const mapped = request.forecast_dates.map((date, i) => {
    const pred = forecast.find(f => f.date === date)
    return {
      date,
      expected: pred?.expected ?? 0,
      lower: pred?.lower ?? 0,
      upper: pred?.upper ?? 0,
    }
  })
  return {
    model: 'trend+weekly-seasonality (lambda baseline)',
    model_version: 'baseline-utc-v1',
    interval: { method: 'uncalibrated residual normal approximation', nominal_level: 0.8 },
    forecast: mapped,
  }
}

async function evaluateProduct(productId, sales) {
  const predict = (request) => baselineProvider(request)
  const [accuracy, coverage] = await Promise.all([
    backtestOneStep(sales, predict),
    evaluateIntervalCoverage(sales, predict),
  ])
  return { productId, ...accuracy.summary, ...coverage }
}

const dataset = getDemoDataset()
const results = await Promise.all(
  Object.keys(dataset.sales_history).map(id => evaluateProduct(id, dataset.sales_history[id]))
)

console.log('\n=== Provider Evaluation: Baseline (trend+weekly-seasonality) ===\n')
console.log('Metric'.padEnd(15) + 'P001'.padEnd(12) + 'P002'.padEnd(12) + 'P003'.padEnd(12) + 'P004'.padEnd(12) + 'P005')
console.log('-'.repeat(90))

const metrics = ['n', 'mae', 'mape', 'coverage', 'within', 'total']
for (const metric of metrics) {
  const row = results.map(r => {
    const val = r[metric]
    if (val === null) return 'N/A'.padEnd(12)
    if (metric === 'mae') return val.toFixed(2).padEnd(12)
    if (metric === 'mape') return val.toFixed(1).padEnd(12)
    if (metric === 'coverage') return (val * 100).toFixed(0) + '%'.padEnd(12)
    return String(val).padEnd(12)
  }).join('')
  console.log(metric.padEnd(15) + row)
}

console.log('\n=== Interpretation ===')
console.log('• n = number of 1-step-ahead predictions evaluated (minimum 28-day history)')
console.log('• MAE = Mean Absolute Error (units per day)')
console.log('• MAPE = Mean Absolute Percentage Error (lower is better)')
console.log('• coverage = fraction of actuals within predicted 80% interval')
console.log('• Target coverage: ~80% (nominal level)')
console.log('\nNote: This is historical backtesting, not a guarantee of future accuracy.')
console.log('The baseline model is uncalibrated; interval coverage may differ from nominal.')
