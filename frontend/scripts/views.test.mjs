import test from 'node:test'
import assert from 'node:assert/strict'
import { loadProductView, loadCatalogAnalyses, catalogSummary } from '../src/services/views.js'

test('optional endpoint failures preserve product and successful reads', async () => {
  const api = {
    fetchProduct: async () => ({ product_id: 'P001' }),
    fetchSalesHistory: async () => [{ date: '2026-01-01', units_sold: 1 }],
    fetchCompetitors: async () => { throw new Error('Competitors unavailable') },
    fetchForecast: async () => ({ model: null, forecast: [] }),
    fetchAnalysis: async () => { throw new Error('Insufficient data') },
  }
  const result = await loadProductView(api, 'P001')
  assert.equal(result.sales.length, 1)
  assert.deepEqual(result.competitors, [])
  assert.equal(result.analysis, null)
  assert.equal(result.errors.analysis, 'Insufficient data')
  assert.equal(result.errors.competitors, 'Competitors unavailable')
})

test('required product failure does not launch optional reads', async () => {
  await assert.rejects(loadProductView({ fetchProduct: async () => { throw new Error('Not found') } }, 'missing'), /Not found/)
})

test('catalog isolates failures, excludes unknown status from summary and supports empty data', async () => {
  const products = [{ product_id: 'P001' }, { product_id: 'P002' }]
  const analysis = { recommendation: { status: 'attention' }, competitor_metrics: { competitor_median_price: 100, seller_price: 110 }, forecast_summary: { total_expected_14d: 20 }, generated_at: '2026-09-18T00:00:00Z' }
  const result = await loadCatalogAnalyses(products, async (id) => {
    if (id === 'P002') throw new Error('Unavailable')
    return analysis
  })
  assert.equal(result.errors.P002, 'Unavailable')
  assert.equal(result.analyses.P002, undefined)
  assert.deepEqual(catalogSummary(products, result.analyses), { available: 1, attention: 1, median: 100, revenue: 2200, latest: analysis.generated_at })
  assert.equal(catalogSummary(products, {}).revenue, null)
  assert.deepEqual(await loadCatalogAnalyses([], () => assert.fail()), { analyses: {}, errors: {} })
})
