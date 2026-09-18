import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalServer } from '../local/server.mjs'

// Fixed varied synthetic observations; dates generated independently of forecast helpers.
test('loopback forecast agrees with analysis for a fixed 120-day sales history', async (t) => {
  const sales = Array.from({ length: 120 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    units_sold: 20 + Math.floor(i / 12) + (i % 7 === 0 ? 8 : 0), price: 100,
  }))
  const app = createLocalServer({
    products: [{ product_id: 'P001', price: 100 }],
    sales_history: { P001: sales },
    competitors: { P001: [{ product_id: 'P001', competitor_id: 'C001',
      observation_date: '2025-04-30', price: 95 }] },
  })
  const base = await app.listen(0)
  t.after(() => app.close())
  const get = async (suffix) => {
    const response = await fetch(`${base}/api/products/P001/${suffix}`)
    assert.equal(response.status, 200)
    return response.json()
  }
  const forecast = await get('forecast')
  assert.equal(forecast.status, 'available')
  assert.equal(forecast.reason, null)
  assert.equal(forecast.horizon_days, 14)
  assert.equal(forecast.forecast.length, 14)
  forecast.forecast.forEach((row, i) => {
    assert.equal(row.date, `2025-05-${String(i + 1).padStart(2, '0')}`)
    assert.ok([row.lower, row.expected, row.upper].every((n) => Number.isFinite(n) && n >= 0))
    assert.ok(row.lower <= row.expected && row.expected <= row.upper)
  })
  const analysis = await get('analysis')
  assert.equal(analysis.forecast_summary.total_expected_14d,
    forecast.forecast.reduce((sum, row) => sum + row.expected, 0))
  assert.equal(analysis.competitor_metrics.competitor_median_price, 95)
  assert.deepEqual(await get('sales'), sales)
})
