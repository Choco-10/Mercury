import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalServer } from '../local/server.mjs'

test('short history: HTTP forecast, GET analysis and saved analysis agree on unavailable', async (t) => {
  const app = createLocalServer({
    products: [{ product_id: 'P001', price: 100 }],
    sales_history: { P001: [1, 2, 3].map((d) => ({ date: `2026-09-0${d}`, units_sold: 10 })) },
    competitors: { P001: [{ competitor_id: 'C001', price: 100, observation_date: '2026-09-03' }] },
  })
  const base = await app.listen(0)
  t.after(() => app.close())
  const read = async (path, options) => {
    const response = await fetch(`${base}/api/products/P001/${path}`, options)
    assert.equal(response.status, 200)
    return response.json()
  }
  const forecast = await read('forecast')
  const analysis = await read('analysis')
  const saved = await read('analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(forecast.status, 'unavailable')
  assert.equal(forecast.reason, 'insufficient_history')
  assert.deepEqual(forecast.forecast, [])
  for (const result of [analysis, saved]) {
    assert.equal(result.forecast_summary.status, forecast.status)
    assert.equal(result.forecast_summary.reason, forecast.reason)
    assert.equal(result.forecast_summary.total_expected_14d, null)
    assert.equal(result.forecast_summary.expected_mean_daily, null)
    assert.equal(result.forecast_summary.delta_vs_recent_pct, null)
    assert.equal(result.competitor_metrics.competitor_median_price, 100)
    assert.equal(result.demand.trend, 'insufficient_data')
  }
  assert.ok(saved.analysis_id)
})
