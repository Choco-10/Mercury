import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../src/handlers/api.mjs'

const product = { product_id: 'P001', price: 100 }
const sales = [
  { date: '2026-08-31', units_sold: 999 },
  ...Array.from({ length: 21 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    units_sold: 100,
  })),
]

function fixture(overrides = {}) {
  const calls = []
  const unexpected = (name) => async (...args) => {
    calls.push([name, ...args])
    throw new Error(`Unexpected storage call: ${name}`)
  }
  const store = {
    getProducts: async () => {
      calls.push(['getProducts'])
      return [product]
    },
    getProduct: async (id) => {
      calls.push(['getProduct', id])
      return id === product.product_id ? product : null
    },
    getSales: async (id) => {
      calls.push(['getSales', id])
      return sales
    },
    getCompetitorsLatest: unexpected('getCompetitorsLatest'),
    putSales: unexpected('putSales'),
    putCompetitors: unexpected('putCompetitors'),
    putAnalysis: unexpected('putAnalysis'),
    ...overrides,
  }
  return { handle: createHandler(store), calls }
}

function event(overrides = {}) {
  return {
    version: '2.0',
    routeKey: 'POST /api/products/{id}/simulate-price',
    rawPath: '/prod/api/products/P001/simulate-price',
    requestContext: { stage: 'prod', http: { method: 'POST' } },
    pathParameters: { id: 'P001' },
    isBase64Encoded: false,
    body: JSON.stringify({ scenario_prices: [90, 100, 110] }),
    ...overrides,
  }
}

function responseBody(response, status) {
  assert.equal(response.statusCode, status, response.body)
  assert.equal(response.headers['Content-Type'], 'application/json')
  return JSON.parse(response.body)
}

// Hand-calculated expectations; older sales must not affect the 21-row baseline.
const expected = {
  product_id: 'P001',
  baseline_price: 100,
  scenarios: [
    { price: 90, price_change_pct: -10, expected_daily_demand: 114,
      estimated_daily_revenue: 10260, competitor_position: 'undercutting' },
    { price: 100, price_change_pct: 0, expected_daily_demand: 100,
      estimated_daily_revenue: 10000, competitor_position: 'at_par' },
    { price: 110, price_change_pct: 10, expected_daily_demand: 86,
      estimated_daily_revenue: 9460, competitor_position: 'premium' },
  ],
}

for (const [name, rawPath, stage] of [
  ['named-stage path', '/prod/api/products/P001/simulate-price', 'prod'],
  ['stage-free named stage', '/api/products/P001/simulate-price', 'prod'],
  ['default stage', '/api/products/P001/simulate-price', '$default'],
]) {
  test(`valid simulation: ${name}`, async () => {
    const { handle, calls } = fixture()
    const result = await handle(event({
      rawPath, requestContext: { stage, http: { method: 'POST' } },
    }))
    assert.deepEqual(responseBody(result, 200), expected)
    assert.deepEqual(calls, [['getProduct', 'P001'], ['getSales', 'P001']])
  })
}

test('base64-encoded JSON body', async () => {
  const { handle } = fixture()
  const input = event()
  input.body = Buffer.from(input.body, 'utf8').toString('base64')
  input.isBase64Encoded = true
  assert.deepEqual(responseBody(await handle(input), 200), expected)
})

test('positive decimal prices retain their numeric value', async () => {
  const { handle } = fixture()
  const result = await handle(event({
    body: JSON.stringify({ scenario_prices: [99.5] }),
  }))
  assert.deepEqual(responseBody(result, 200).scenarios, [{
    price: 99.5, price_change_pct: -0.5, expected_daily_demand: 101,
    estimated_daily_revenue: 10050, competitor_position: 'at_par',
  }])
})

const invalidBodies = [
  ['missing body', undefined], ['empty body', ''],
  ['malformed JSON', '{"scenario_prices":'],
  ['null body', 'null'], ['array body', '[]'], ['string body', '"text"'],
  ['number body', '123'], ['boolean body', 'true'],
  ['missing prices', '{}'], ['null prices', '{"scenario_prices":null}'],
  ['non-array prices', '{"scenario_prices":100}'],
  ['empty prices', '{"scenario_prices":[]}'],
  ['string price', '{"scenario_prices":["100"]}'],
  ['null price', '{"scenario_prices":[null]}'],
  ['boolean price', '{"scenario_prices":[true]}'],
  ['object price', '{"scenario_prices":[{}]}'],
  ['array price', '{"scenario_prices":[[100]]}'],
  ['zero price', '{"scenario_prices":[0]}'],
  ['negative price', '{"scenario_prices":[-1]}'],
  ['mixed invalid prices', '{"scenario_prices":[100,-1]}'],
  ['numeric overflow', '{"scenario_prices":[1e309]}'],
]

for (const [name, body] of invalidBodies) {
  test(`400 without storage access: ${name}`, async () => {
    const { handle, calls } = fixture()
    const result = responseBody(await handle(event({ body })), 400)
    assert.equal(typeof result.error, 'string')
    assert.ok(result.error.length > 0)
    assert.deepEqual(calls, [])
  })
}

test('missing product returns 404 without reading sales', async () => {
  const { handle, calls } = fixture()
  const result = await handle(event({
    rawPath: '/prod/api/products/UNKNOWN/simulate-price',
    pathParameters: { id: 'UNKNOWN' },
  }))
  assert.deepEqual(responseBody(result, 404), { error: 'Product UNKNOWN not found' })
  assert.deepEqual(calls, [['getProduct', 'UNKNOWN']])
})

const unsupportedRoutes = [
  ['GET', '/prod/api/products/P001/simulate-price'],
  ['PUT', '/prod/api/products/P001/simulate-price'],
  ['DELETE', '/prod/api/products/P001/simulate-price'],
  ['GET', '/prod/api/products/P001/analyze'],
  ['POST', '/prod/api/products/P001/unknown'],
  ['POST', '/prod/api/products/P001/simulate-price/extra'],
  ['POST', '/prod/api/products/P001/extra/simulate-price'],
  ['POST', '/production/api/products/P001/simulate-price'],
  ['POST', '/prod/apix/products/P001/simulate-price'],
  ['POST', '/prod/api/products/P002/simulate-price'],
  ['GET', '/prod/api/products/P001/unknown'],
  ['GET', '/prod/api/products/P001/extra/sales'],
  ['GET', '/prod/api/products/P001/extra/P001'],
]

for (const [method, rawPath] of unsupportedRoutes) {
  test(`unsupported route without storage: ${method} ${rawPath}`, async () => {
    const { handle, calls } = fixture()
    const result = await handle(event({
      rawPath,
      requestContext: { stage: 'prod', http: { method } },
      routeKey: '$default',
    }))
    assert.match(responseBody(result, 404).error, /^No route for /)
    assert.deepEqual(calls, [])
  })
}

test('missing product path parameter is an unsupported route', async () => {
  const { handle, calls } = fixture()
  const result = await handle(event({ pathParameters: undefined }))
  assert.match(responseBody(result, 404).error, /^No route for /)
  assert.deepEqual(calls, [])
})

test('GET products remains available', async () => {
  const { handle, calls } = fixture()
  const result = await handle(event({
    routeKey: 'GET /api/products',
    rawPath: '/prod/api/products',
    requestContext: { stage: 'prod', http: { method: 'GET' } },
    pathParameters: undefined,
    body: undefined,
  }))
  assert.deepEqual(responseBody(result, 200), [product])
  assert.deepEqual(calls, [['getProducts']])
})

test('GET product remains available', async () => {
  const { handle, calls } = fixture()
  const result = await handle(event({
    routeKey: 'GET /api/products/{id}',
    rawPath: '/api/products/P001',
    requestContext: { stage: '$default', http: { method: 'GET' } },
    body: undefined,
  }))
  assert.deepEqual(responseBody(result, 200), product)
  assert.deepEqual(calls, [['getProduct', 'P001']])
})

test('storage failure remains a generic 500', async () => {
  const { handle } = fixture({
    getSales: async () => {
      throw new Error('Intentional test storage failure')
    },
  })
  assert.deepEqual(responseBody(await handle(event()), 500), {
    error: 'Internal server error',
  })
})

test('incomplete injected storage is rejected, not replaced with AWS', () => {
  assert.throws(() => createHandler({}), /Missing storage dependency: getProducts/)
})

