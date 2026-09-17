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

test('forecast numerical overflow gives explicit unavailable envelope', () => {
  // Individually safe inputs can still overflow intermediate arithmetic precision,
  // but invalid non-finite source values must never be emitted as forecast numbers.
  const result = forecastResponse('P001', Array.from({ length: 3 }, (_, i) => ({
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
      'putSales', 'putCompetitors', 'putAnalysis',
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
