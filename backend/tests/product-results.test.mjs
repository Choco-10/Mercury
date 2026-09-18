import test from 'node:test'
import assert from 'node:assert/strict'
import { pricingResponse, forecastResponse } from '../src/services/product-results.js'
import { createHandler } from '../src/handlers/api.mjs'

const product = { product_id: 'P001', price: 100 }
const sales = [{ date: '2026-09-01', units_sold: 10 }]

for (const price of [1e308, Number.MAX_VALUE]) {
  test(`finite input overflow is rejected: ${price}`, () => {
    assert.throws(() => pricingResponse(product, sales, [price]),
      (err) => err.statusCode === 400 && /numerical range/.test(err.message))
  })
}

test('unsafe revenue is rejected rather than silently losing integer precision', () => {
  assert.throws(() => pricingResponse({ ...product, price: 1e15 }, sales, [1e15]),
    (err) => err.statusCode === 400)
})

test('pricing sorts history without modifying it', () => {
  const rows = Array.from({ length: 22 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`, units_sold: i === 0 ? 999 : 10,
  })).reverse()
  const before = structuredClone(rows)
  assert.equal(pricingResponse(product, rows, [100]).scenarios[0].expected_daily_demand, 10)
  assert.deepEqual(rows, before)
})

const forecastSales = Array.from({ length: 28 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, '0')}`, units_sold: 10,
}))

for (const [name, rows, reason] of [
  ['empty', [], 'insufficient_history'],
  ['short', sales, 'insufficient_history'],
  ['non-array', null, 'invalid_sales_data'],
  ['invalid date', [...forecastSales, { date: '2026-02-30', units_sold: 10 }], 'invalid_sales_data'],
  ['duplicate', [...forecastSales, forecastSales[0]], 'invalid_sales_data'],
  ['negative', [...forecastSales, { date: '2026-10-01', units_sold: -1 }], 'invalid_sales_data'],
  ['fractional', [...forecastSales, { date: '2026-10-01', units_sold: 1.5 }], 'invalid_sales_data'],
  ['unsafe', [...forecastSales, { date: '2026-10-01', units_sold: Number.MAX_SAFE_INTEGER + 1 }], 'invalid_sales_data'],
  ['non-finite', [...forecastSales, { date: '2026-10-01', units_sold: Infinity }], 'invalid_sales_data'],
  ['wrong product', [...forecastSales, { date: '2026-10-01', units_sold: 1, product_id: 'OTHER' }], 'invalid_sales_data'],
]) {
  test(`forecast diagnostics: ${name}`, async () => {
    const before = structuredClone(rows)
    const result = await forecastResponse('P001', rows)
    assert.equal(result.status, 'unavailable')
    assert.equal(result.reason, reason)
    assert.equal(result.model, null)
    assert.deepEqual(result.forecast, [])
    assert.equal(result.product_id, 'P001')
    assert.equal(result.horizon_days, 14)
    assert.equal(new Date(result.generated_at).toISOString(), result.generated_at)
    assert.deepEqual(rows, before)
  })
}

for (const units of [0, 10]) {
  test(`successful forecast availability for ${units} daily units`, async () => {
    const rows = forecastSales.map((row) => ({ ...row, units_sold: units })).reverse()
    const before = structuredClone(rows)
    const result = await forecastResponse('P001', rows)
    assert.equal(result.status, 'available')
    assert.equal(result.reason, null)
    assert.equal(result.model, 'trend+weekly-seasonality (lambda baseline)')
    assert.equal(result.forecast.length, 14)
    assert.ok(result.forecast.every((row) => row.expected === units))
    assert.deepEqual(rows, before)
  })
}

test('unexpected calculation-path exception has only a controlled public reason', async () => {
  const rows = [...forecastSales]
  // Exercise the catch without adding a pretend provider to production code.
  rows[Symbol.iterator] = () => { throw new Error('Private diagnostic: secret') }
  const result = await forecastResponse('P001', rows)
  assert.equal(result.status, 'unavailable')
  assert.equal(result.reason, 'calculation_failed')
  assert.equal(result.model, null)
  assert.deepEqual(result.forecast, [])
  assert.ok(!JSON.stringify(result).includes('Private diagnostic'))
})


test('non-finite forecast inputs give an unavailable envelope', async () => {
  // Invalid non-finite source values must never be emitted as forecast numbers.
  const result = await forecastResponse('P001', Array.from({ length: 3 }, (_, i) => ({
    date: `2026-09-0${i + 1}`, units_sold: Infinity,
  })))
  assert.equal(result.model, null)
  assert.deepEqual(result.forecast, [])
  assert.equal(result.horizon_days, 14)
})

for (const text of [
  '{', 'null', '[]', 'true', '123', '"text"', '{}',
  '{"type":"inventory","csv":"data"}',
  '{"type":"sales","csv":null}',
  '{"type":"sales","csv":123}',
  '{"type":"sales","csv":"   "}',
]) {
  test(`upload envelope rejected before storage: ${text}`, async () => {
    let calls = 0
    const unexpected = async () => { calls++; throw new Error('Unexpected storage access') }
    const handle = createHandler(Object.fromEntries([
      'getProducts', 'getProduct', 'getSales', 'getCompetitorsLatest',
      'putSales', 'putCompetitors', 'putAnalysis', 'getAnalysis',
    ].map((name) => [name, unexpected])))
    const response = await handle({
      version: '2.0', rawPath: '/api/data/upload',
      requestContext: { stage: '$default', http: { method: 'POST' } },
      body: text,
    })
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(typeof JSON.parse(response.body).error, 'string')
    assert.equal(calls, 0)
  })
}
