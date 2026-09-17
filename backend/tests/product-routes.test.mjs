import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../src/handlers/api.mjs'

const product = { product_id: 'P001', price: 100 }
const sales = Array.from({ length: 28 }, (_, i) => ({
  product_id: 'P001', date: `2026-09-${String(i + 1).padStart(2, '0')}`, units_sold: 10,
}))
const competitors = [
  { product_id: 'P001', competitor_id: 'C001', price: 100 },
  { product_id: 'P001', competitor_id: 'C002', price: 90 },
]

function fixture(overrides = {}) {
  const calls = []
  const writtenSales = []
  const unused = async () => { throw new Error('Unexpected storage operation') }
  const store = {
    putSales: async (pid, rows) => { calls.push('writeSales'); writtenSales.push([pid, rows]) },
    putCompetitors: unused,
    putAnalysis: unused,
    getProducts: async () => { calls.push('products'); return [product] },
    getProduct: async (id) => { calls.push('product'); return id === 'P001' ? product : null },
    getSales: async () => { calls.push('sales'); return sales },
    getCompetitorsLatest: async () => { calls.push('competitors'); return competitors },
    ...overrides,
  }
  return { handle: createHandler(store), calls, writtenSales }
}

function event(overrides = {}) {
  return {
    version: '2.0',
    rawPath: '/prod/api/products/P001',
    routeKey: 'GET /api/products/{id}/{sub}',
    requestContext: { stage: 'prod', http: { method: 'GET' } },
    pathParameters: { id: 'P001' },
    isBase64Encoded: false,
    ...overrides,
  }
}

function get(path, stage = 'prod') {
  return event({
    rawPath: stage === '$default' ? path : `/prod${path}`,
    requestContext: { stage, http: { method: 'GET' } },
  })
}

function post(path, bodyText, stage = 'prod') {
  return event({
    rawPath: stage === '$default' ? path : `/prod${path}`,
    requestContext: { stage, http: { method: 'POST' } },
    routeKey: 'POST /api/products/{id}/{sub}',
    body: bodyText,
  })
}

function body(result, status) {
  assert.equal(result.statusCode, status, result.body)
  assert.equal(result.headers['Content-Type'], 'application/json')
  return JSON.parse(result.body)
}

function assertNoSpecialJsonValues(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `non-finite number: ${value}`)
  else if (value && typeof value === 'object') Object.values(value).forEach(assertNoSpecialJsonValues)
}

test('GET /products lists products', async () => {
  const { handle, calls } = fixture()
  assert.deepEqual(body(await handle(get('/api/products')), 200), [product])
  assert.deepEqual(calls, ['products'])
})

test('GET /products/{id} returns the product', async () => {
  const { handle, calls } = fixture()
  assert.deepEqual(body(await handle(get('/api/products/P001')), 200), product)
  assert.deepEqual(calls, ['product'])
})

test('GET sales and competitors return their stored records', async () => {
  const { handle, calls } = fixture()
  assert.deepEqual(body(await handle(get('/api/products/P001/sales')), 200), sales)
  assert.deepEqual(calls, ['product', 'sales'])

  const second = fixture()
  assert.deepEqual(body(await second.handle(get('/api/products/P001', '$default')), 200), product)
  assert.deepEqual(second.calls, ['product'])

  const third = fixture()
  assert.deepEqual(body(await third.handle(get('/api/products/P001/competitors')), 200), competitors)
  assert.deepEqual(third.calls, ['product', 'competitors'])
})

test('GET forecast returns 14 ordered days or an explicit empty result', async () => {
  const { handle, calls } = fixture()
  const result = body(await handle(get('/api/products/P001/forecast')), 200)
  assert.equal(result.product_id, 'P001')
  assert.equal(result.horizon_days, 14)
  assert.match(result.model, /lambda baseline/)
  assert.equal(result.forecast.length, 14)
  assert.ok(result.forecast.every((day) =>
    Number.isInteger(day.expected) && day.lower <= day.expected && day.expected <= day.upper))
  assert.ok(result.forecast.every((day, i) => i === 0 || day.date > result.forecast[i - 1].date))
  assert.deepEqual(calls, ['product', 'sales'])

  const empty = fixture({ getSales: async () => [] })
  const fallback = body(await empty.handle(get('/api/products/P001/forecast')), 200)
  assert.deepEqual(fallback, {
    product_id: 'P001', model: null, forecast: [],
    horizon_days: 14, generated_at: fallback.generated_at,
  })
  assert.equal(new Date(fallback.generated_at).toISOString(), fallback.generated_at)
})

test('GET analysis is valid JSON with the documented shape', async () => {
  const { handle, calls } = fixture()
  const result = body(await handle(get('/api/products/P001/analysis')), 200)
  assertNoSpecialJsonValues(result)
  assert.deepEqual(Object.keys(result).sort(), [
    'competitor_metrics', 'demand', 'forecast_summary', 'generated_at', 'product_id', 'recommendation',
  ])
  assert.equal(result.competitor_metrics.seller_position, 'within_range')
  assert.equal(result.competitor_metrics.competitor_median_price, 95)
  assert.deepEqual(calls, ['product', 'sales', 'competitors'])
})

test('GET analysis matches POST /analyze calculations without saving on GET', async () => {
  const saved = []
  const { handle } = fixture({ putAnalysis: async (snapshot) => { saved.push(snapshot) } })
  const got = body(await handle(get('/api/products/P001/analysis')), 200)
  assert.equal(saved.length, 0)
  const posted = body(await handle(post('/api/products/P001/analyze')), 200)
  assert.equal(saved.length, 1)
  for (const key of ['product_id', 'competitor_metrics', 'demand', 'forecast_summary', 'recommendation']) {
    assert.deepEqual(posted[key], got[key])
  }
})

for (const sub of ['', '/sales', '/competitors', '/forecast', '/analysis']) {
  test(`missing product stops reads: ${sub || 'detail'}`, async () => {
    const { handle, calls } = fixture()
    body(await handle(event({
      rawPath: `/api/products/MISSING${sub}`, pathParameters: { id: 'MISSING' },
    })), 404)
    assert.deepEqual(calls, ['product'])
  })
}

for (const [path, dependency] of [
  ['/api/products', 'getProducts'],
  ['/api/products/P001', 'getProduct'],
  ['/api/products/P001/sales', 'getSales'],
  ['/api/products/P001/competitors', 'getCompetitorsLatest'],
  ['/api/products/P001/forecast', 'getSales'],
  ['/api/products/P001/analysis', 'getCompetitorsLatest'],
]) {
  test(`storage failure is generic: ${path}`, async (t) => {
    t.mock.method(console, 'error', () => {})
    const { handle } = fixture({ [dependency]: async () => { throw new Error('Private diagnostic') } })
    assert.deepEqual(body(await handle(get(path)), 500), { error: 'Internal server error' })
  })
}

test('independent reads survive unrelated storage failures', async () => {
  const fail = async () => { throw new Error('Must not be called') }
  const a = fixture({ getCompetitorsLatest: fail })
  body(await a.handle(get('/api/products/P001/sales')), 200)
  body(await a.handle(get('/api/products/P001/forecast')), 200)
  const b = fixture({ getSales: fail })
  body(await b.handle(get('/api/products/P001/competitors')), 200)
})

test('empty collections are successful reads, not invented data', async () => {
  const { handle } = fixture({
    getProducts: async () => [], getSales: async () => [], getCompetitorsLatest: async () => [],
  })
  for (const path of ['/api/products', '/api/products/P001/sales', '/api/products/P001/competitors']) {
    assert.deepEqual(body(await handle(get(path)), 200), [])
  }
  assert.ok(body(await handle(get('/api/products/P001/analysis')), 422).issues.length)
})

for (const badSales of [
  sales.slice(0, 2),
  [...sales, { date: '2026-02-30', units_sold: 10 }],
  [...sales, { date: '2026-10-01', units_sold: NaN }],
  [...sales, sales[0]],
]) {
  test('invalid/short history yields empty forecast with metadata', async () => {
    const { handle } = fixture({ getSales: async () => badSales })
    const result = body(await handle(get('/api/products/P001/forecast')), 200)
    assert.equal(result.model, null)
    assert.equal(result.horizon_days, 14)
    assert.deepEqual(result.forecast, [])
    assert.ok(result.generated_at)
  })
}

test('analysis rejects empty competitors instead of null-serialized infinities', async () => {
  const { handle } = fixture({ getCompetitorsLatest: async () => [] })
  assert.deepEqual(body(await handle(get('/api/products/P001/analysis')), 422).issues,
    ['At least one competitor observation is required'])
})

test('GET analysis calculation overflow returns generic 500', async (t) => {
  t.mock.method(console, 'error', () => {})
  const { handle } = fixture({
    getProduct: async () => ({ ...product, price: Number.MAX_VALUE }),
    getCompetitorsLatest: async () => [{ price: Number.MIN_VALUE }],
  })
  assert.deepEqual(body(await handle(get('/api/products/P001/analysis')), 500),
    { error: 'Internal server error' })
})

test('pricing accepts 25 scenarios and rejects 26 before reads', async () => {
  const { handle, calls } = fixture()
  body(await handle(post('/api/products/P001/simulate-price',
    JSON.stringify({ scenario_prices: Array(26).fill(100) }))), 400)
  assert.deepEqual(calls, [])
  const result = body(await handle(post('/api/products/P001/simulate-price',
    JSON.stringify({ scenario_prices: Array(25).fill(100) }))), 200)
  assert.equal(result.scenarios.length, 25)
})

for (const [name, overrides] of [
  ['zero product price', { getProduct: async () => ({ ...product, price: 0 }) }],
  ['non-finite product price', { getProduct: async () => ({ ...product, price: Infinity }) }],
  ['missing sales', { getSales: async () => [] }],
  ['zero demand', { getSales: async () => sales.map((s) => ({ ...s, units_sold: 0 })) }],
  ['invalid units', { getSales: async () => sales.map((s) => ({ ...s, units_sold: -1 })) }],
]) {
  test(`pricing rejects invalid baseline: ${name}`, async () => {
    const { handle } = fixture(overrides)
    assert.ok(body(await handle(post('/api/products/P001/simulate-price',
      '{"scenario_prices":[100]}')), 422).error)
  })
}


