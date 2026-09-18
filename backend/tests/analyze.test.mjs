import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../src/handlers/api.mjs'
import { createAnalysisWriter, createAnalysisReader } from '../src/services/analysis-store.js'
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'

const product = { product_id: 'P001', price: 100 }
const sales = Array.from({ length: 28 }, (_, i) => ({
  product_id: 'P001', date: `2026-09-${String(i + 1).padStart(2, '0')}`, units_sold: 10,
}))
const competitors = [{ product_id: 'P001', competitor_id: 'C001', price: 100 }]

function fixture(overrides = {}) {
  const calls = []
  const snapshots = []
  const unused = async () => { throw new Error('Unexpected storage operation') }
  const store = {
    getProducts: unused, putSales: unused, putCompetitors: unused,
    getProduct: async (id) => { calls.push('product'); return id === 'P001' ? product : null },
    getSales: async () => { calls.push('sales'); return sales },
    getCompetitorsLatest: async () => { calls.push('competitors'); return competitors },
    getAnalysis: async () => { calls.push('read'); return cached ?? null },
    putAnalysis: async (snapshot) => { calls.push('write'); snapshots.push(structuredClone(snapshot)) },
    ...overrides,
  }
  let cached = null
  // Use a fixed clock so age_days is deterministic regardless of when tests run.
  const fixedDate = new Date('2026-09-28T00:00:00.000Z')
  const forecastOptions = { now: () => fixedDate, ...overrides.forecastOptions }
  return { handle: createHandler(store, { forecastOptions }), calls, snapshots }
}

function event(overrides = {}) {
  return {
    version: '2.0', rawPath: '/prod/api/products/P001/analyze',
    routeKey: 'POST /api/products/{id}/analyze',
    requestContext: { stage: 'prod', http: { method: 'POST' } },
    pathParameters: { id: 'P001' }, isBase64Encoded: false,
    ...overrides,
  }
}

function body(result, status) {
  assert.equal(result.statusCode, status, result.body)
  return JSON.parse(result.body)
}

for (const [rawPath, stage] of [
  ['/prod/api/products/P001/analyze', 'prod'],
  ['/api/products/P001/analyze', 'prod'],
  ['/api/products/P001/analyze', '$default'],
]) {
  test(`analysis saved and returned: ${stage} ${rawPath}`, async () => {
    const { handle, calls, snapshots } = fixture()
    const result = body(await handle(event({
      rawPath, requestContext: { stage, http: { method: 'POST' } },
    })), 200)
    assert.deepEqual(snapshots, [result])
    assert.deepEqual(calls, ['product', 'read', 'sales', 'competitors', 'write'])
    assert.match(result.analysis_id, /^[0-9a-f-]{36}$/)
    assert.equal(new Date(result.generated_at).toISOString(), result.generated_at)
    assert.equal(result.product_id, 'P001')
    assert.deepEqual(result.demand, { trend: 'stable', change_pct: 0, slope_30d: 0 })
    assert.deepEqual(result.forecast_summary, {
      horizon_days: 14,
      status: 'available',
      reason: null,
      model: 'trend+weekly-seasonality (lambda baseline)',
      model_version: 'baseline-utc-v1',
      forecast_origin: '2026-09-28',
      training_cutoff: '2026-09-28',
      training_summary: {
        first_date: '2026-09-01',
        last_date: '2026-09-28',
        observed_days: 28,
        span_days: 28,
        missing_days: 0,
        age_days: 0,
      },
      interval: {
        method: 'uncalibrated residual normal approximation',
        nominal_level: 0.8,
      },
      warnings: [
        'observed_sales_not_unconstrained_demand',
        'forecast_evaluation_not_verified',
      ],
      expected_mean_daily: 10,
      delta_vs_recent_pct: 0,
      total_expected_14d: 140,
    })
    assert.equal(result.competitor_metrics.competitor_median_price, 100)
    assert.equal(result.recommendation.suggested_action, 'monitor')
  })
}

test('same-day repeat request returns the stored snapshot without recomputing', async () => {
  const cached = { product_id: 'P001', analysis_id: 'cached-id', demand: { trend: 'stable' } }
  const { handle, calls, snapshots } = fixture({ getAnalysis: async () => { calls.push('read'); return structuredClone(cached) } })
  const result = body(await handle(event()), 200)
  assert.deepEqual(result, cached)
  assert.deepEqual(calls, ['product', 'read'])
  assert.deepEqual(snapshots, [])
})

test('empty object and base64 object accepted', async () => {
  const { handle, snapshots } = fixture()
  const first = body(await handle(event({ body: '{}' })), 200)
  const second = body(await handle(event({ body: 'e30=', isBase64Encoded: true })), 200)
  // Same-day idempotency: the second POST recompute is stored but both
  // requests that computed wrote once each — two writes, two distinct ids.
  assert.equal(snapshots.length, 2)
  assert.notEqual(first.analysis_id, second.analysis_id)
})

for (const input of ['{', 'null', '[]', 'true', '1', '"text"', '{"price":5}']) {
  test(`bad analysis body rejected before reads: ${input}`, async () => {
    const { handle, calls } = fixture()
    assert.ok(body(await handle(event({ body: input })), 400).error)
    assert.deepEqual(calls, [])
  })
}

test('missing product does not compute or write', async () => {
  const { handle, calls, snapshots } = fixture()
  body(await handle(event({
    rawPath: '/api/products/MISSING/analyze', pathParameters: { id: 'MISSING' },
  })), 404)
  assert.deepEqual(calls, ['product'])
  assert.deepEqual(snapshots, [])
})

for (const [name, overrides] of [
  ['no sales', { getSales: async () => [] }],
  ['two records', { getSales: async () => sales.slice(0, 2) }],
  ['no competitors', { getCompetitorsLatest: async () => [] }],
  ['invalid product price', { getProduct: async () => ({ ...product, price: 0 }) }],
  ['invalid date', { getSales: async () => [...sales, { date: '2026-02-30', units_sold: 1 }] }],
  ['negative units', { getSales: async () => [...sales, { date: '2026-10-01', units_sold: -1 }] }],
  ['duplicate date', { getSales: async () => [...sales, sales[0]] }],
  ['invalid competitor', { getCompetitorsLatest: async () => [{ price: Infinity }] }],
]) {
  test(`invalid source data: ${name}`, async () => {
    const { handle, snapshots } = fixture(overrides)
    assert.ok(body(await handle(event()), 422).issues.length)
    assert.deepEqual(snapshots, [])
  })
}

for (const operation of ['getProduct', 'getSales', 'getCompetitorsLatest', 'putAnalysis']) {
  test(`${operation} failure returns 500`, async (t) => {
    t.mock.method(console, 'error', () => {})
    const { handle, snapshots } = fixture({
      [operation]: async () => { throw new Error('Private storage diagnostic') },
    })
    assert.deepEqual(body(await handle(event()), 500), { error: 'Internal server error' })
    assert.deepEqual(snapshots, [])
  })
}

test('non-finite calculation is not saved', async (t) => {
  t.mock.method(console, 'error', () => {})
  const { handle, snapshots } = fixture({
    getProduct: async () => ({ ...product, price: Number.MAX_VALUE }),
    getCompetitorsLatest: async () => [{ price: Number.MIN_VALUE }],
  })
  body(await handle(event()), 500)
  assert.deepEqual(snapshots, [])
})

test('GET analysis remains read-only and matches POST calculations', async () => {
  const { handle, snapshots } = fixture()
  const post = body(await handle(event()), 200)
  const get = body(await handle(event({
    rawPath: '/api/products/P001/analysis',
    requestContext: { stage: '$default', http: { method: 'GET' } },
  })), 200)
  assert.equal(snapshots.length, 1)
  assert.equal(Object.hasOwn(get, 'analysis_id'), false)
  for (const key of ['product_id', 'competitor_metrics', 'demand', 'forecast_summary', 'recommendation']) {
    assert.deepEqual(post[key], get[key])
  }
})

test('short history is explicitly labelled insufficient_data', async () => {
  const { handle } = fixture({ getSales: async () => sales.slice(0, 3) })
  assert.equal(body(await handle(event()), 200).demand.trend, 'insufficient_data')
})

test('unsorted sales are sorted without changing source', async () => {
  const reversed = [...sales].reverse()
  const before = structuredClone(reversed)
  const { handle } = fixture({ getSales: async () => reversed })
  assert.equal(body(await handle(event()), 200).forecast_summary.total_expected_14d, 140)
  assert.deepEqual(reversed, before)
})

for (const [method, rawPath] of [
  ['GET', '/api/products/P001/analyze'],
  ['PUT', '/api/products/P001/analyze'],
  ['POST', '/api/products/P001/analyze/extra'],
  ['POST', '/production/api/products/P001/analyze'],
  ['POST', '/prod/apix/products/P001/analyze'],
]) {
  test(`unsupported ${method} ${rawPath}`, async () => {
    const { handle, calls } = fixture()
    body(await handle(event({ rawPath, requestContext: { stage: 'prod', http: { method } } })), 404)
    assert.deepEqual(calls, [])
  })
}

test('response waits for persistence acknowledgement', async () => {
  let acknowledge
  let writing
  const started = new Promise((resolve) => { writing = resolve })
  const gate = new Promise((resolve) => { acknowledge = resolve })
  const { handle } = fixture({ putAnalysis: async () => { writing(); await gate } })
  let returned = false
  const pending = handle(event()).then((result) => { returned = true; return result })
  await started
  assert.equal(returned, false)
  acknowledge()
  body(await pending, 200)
})

test('real writer constructs a date-keyed snapshot PutCommand offline', async () => {
  const snapshot = body(await fixture().handle(event()), 200)
  const commands = []
  const put = createAnalysisWriter({ send: async (command) => { commands.push(command) } }, 'local-test-table')
  await put(snapshot)
  assert.equal(commands.length, 1)
  assert.ok(commands[0] instanceof PutCommand)
  assert.deepEqual(commands[0].input, {
    TableName: 'local-test-table',
    Item: {
      PK: 'PRODUCT#P001',
      SK: `ANALYSIS#${snapshot.generated_at.slice(0, 10)}`,
      data: snapshot,
      updated_at: commands[0].input.Item.updated_at,
    },
  })
})

test('real reader fetches the same-day snapshot and returns null when absent', async () => {
  const commands = []
  const snapshot = { product_id: 'P001', demand: { trend: 'stable' } }
  const read = createAnalysisReader({ send: async (command) => { commands.push(command); return { Item: { data: snapshot } } } }, 'local-test-table')
  assert.deepEqual(await read('P001'), snapshot)
  const miss = createAnalysisReader({ send: async () => ({}) }, 'local-test-table')
  assert.equal(await miss('P001'), null)
  assert.equal(commands.length, 1)
  assert.ok(commands[0] instanceof GetCommand)
  assert.equal(commands[0].input.Key.SK, `ANALYSIS#${new Date().toISOString().slice(0, 10)}`)
})

test('writer propagates transport errors', async () => {
  const failure = new Error('Fake transport failure')
  const put = createAnalysisWriter({ send: async () => { throw failure } }, 'local-test-table')
  await assert.rejects(put({ product_id: 'P001', generated_at: 'date', analysis_id: 'id' }),
    (err) => err === failure)
})
