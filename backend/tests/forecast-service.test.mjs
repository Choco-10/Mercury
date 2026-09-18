import test from 'node:test'
import assert from 'node:assert/strict'
import { createForecastService } from '../../shared/forecast-service.js'
import { createForecastService as packagedService } from '../src/shared/forecast-service.js'
import { addDaysUTC } from '../../shared/series.js'

const now = () => new Date('2024-02-28T12:00:00Z')
const history = (start = '2024-02-01', count = 28) => Array.from({ length: count }, (_, i) => ({
  date: addDaysUTC(start, i), units_sold: i % 7, product_id: 'P001',
}))
// Test fixture only, not a local numerical model or SageMaker adapter.
const prediction = (request, expected = 2.5) => ({
  model: 'test-provider', model_version: 'test-v1',
  interval: { method: 'test-only', nominal_level: null },
  forecast: request.forecast_dates.map((date) => ({ date, expected, lower: 0, upper: expected + 1 })),
})
const make = (options = {}) => createForecastService({
  loadSales: async () => history(), provider: { predict: async (r) => prediction(r) }, now, ...options,
})
test('per-call loader override supplies rows without storage access; invalid override throws', async () => {
  const service = createForecastService({
    loadSales: () => assert.fail('Constructor loader must not run'),
    provider: { predict: async (request) => prediction(request) },
    now,
  })
  const rows = history()
  const result = await service.predict('P001', { loadSales: async () => rows })
  assert.equal(result.status, 'available')
  assert.equal(result.training_summary.observed_days, 28)
  await assert.rejects(service.predict('P001', { loadSales: 'nope' }), TypeError)
})

for (const [name, change] of [
  ['short', (r) => { r.forecast.pop() }],
  ['long', (r) => { r.forecast.push(r.forecast[0]) }],
  ['sparse', (r) => { delete r.forecast[2] }],
  ['wrong date', (r) => { r.forecast[0].date = '2024-03-01' }],
  ['unordered', (r) => { r.forecast.reverse() }],
  ['NaN', (r) => { r.forecast[0].expected = NaN }],
  ['infinity', (r) => { r.forecast[0].upper = Infinity }],
  ['negative', (r) => { r.forecast[0].lower = -1 }],
  ['inverted', (r) => { r.forecast[0].lower = 4 }],
  ['expected above upper', (r) => { r.forecast[0].expected = 4 }],
  ['unsafe aggregate', (r) => { r.forecast.forEach((p) => { p.upper = Number.MAX_SAFE_INTEGER }) }],
  ['no version', (r) => { delete r.model_version }],
  ['no interval', (r) => { delete r.interval }],
  ['bad level', (r) => { r.interval.nominal_level = 80 }],
  ['undefined level', (r) => { delete r.interval.nominal_level }],
]) {
  test(`rejects provider output: ${name}`, async () => {
    const result = await make({ provider: { predict: async (request) => {
      const raw = prediction(request); change(raw); return raw
    } } }).predict('P001')
    assert.equal(result.reason, 'invalid_provider_output')
    assert.equal(result.status, 'unavailable')
    assert.equal(result.model, null)
    assert.deepEqual(result.forecast, [])
  })
}

test('dependency, caller and clock errors fail before loading', async () => {
  assert.throws(() => createForecastService(), TypeError)
  assert.throws(() => make({ provider: {} }), TypeError)
  const service = make({ loadSales: () => assert.fail('Unexpected load') })
  for (const id of ['', null, '../P001']) await assert.rejects(service.predict(id), TypeError)
  for (const horizon of [0, 13, 15, '14', null]) await assert.rejects(service.predict('P001', { horizon }), TypeError)
  await assert.rejects(make({ now: () => new Date(NaN), loadSales: () => assert.fail() }).predict('P001'), TypeError)
})

for (const [start, clock, warning] of [
  ['2023-12-01', '2024-02-28', 'history_ends_before_generation_date'],
  ['2024-03-01', '2024-02-28', 'history_ends_after_generation_date'],
]) {
  test(`cutoff retained with ${warning}`, async () => {
    const rows = history(start)
    const result = await make({ loadSales: async () => rows, now: () => new Date(`${clock}T12:00:00Z`) }).predict('P001')
    assert.equal(result.status, 'available')
    assert.ok(result.warnings.includes(warning))
    assert.equal(result.training_cutoff, rows.at(-1).date)
    assert.equal(result.forecast[0].date, addDaysUTC(rows.at(-1).date, 1))
  })
}

test('unsupported forecast date range stops before provider', async () => {
  const result = await make({ loadSales: async () => history('9999-12-04'),
    provider: { predict: () => assert.fail('Out-of-range origin') } }).predict('P001')
  assert.equal(result.reason, 'unsupported_date_range')
})

test('canonical and packaged services produce identical repeatable results', async () => {
  const options = { loadSales: async () => history(), provider: { predict: async (r) => prediction(r) }, now }
  const result = await createForecastService(options).predict('P001')
  assert.deepEqual(await createForecastService(options).predict('P001'), result)
  assert.deepEqual(await packagedService(options).predict('P001'), result)
})


test('awaits provider, uses immutable sorted inputs and projects a consistent response', async () => {
  const rows = history().reverse()
  const before = structuredClone(rows)
  let finish
  let started
  const ready = new Promise((resolve) => { started = resolve })
  const service = make({ loadSales: async (id) => {
    assert.equal(id, 'P001'); return rows
  }, provider: { predict: async (request) => {
    assert.equal(request.training_cutoff, '2024-02-28')
    assert.equal(request.horizon_days, 14)
    assert.deepEqual(request.dates, before.map((r) => r.date).reverse())
    assert.ok(Object.isFrozen(request) && Object.isFrozen(request.units) && Object.isFrozen(request.dates))
    assert.throws(() => request.units.push(999), TypeError)
    started()
    return new Promise((resolve) => { finish = () => resolve(prediction(request)) })
  } } })
  let returned = false
  const pending = service.predict('P001').then((r) => { returned = true; return r })
  await ready
  assert.equal(returned, false)
  finish()
  const result = await pending
  assert.equal(result.status, 'available')
  assert.equal(result.reason, null)
  assert.equal(result.generated_at, now().toISOString())
  assert.equal(result.forecast_origin, '2024-02-28')
  assert.equal(result.training_cutoff, result.forecast_origin)
  assert.deepEqual(result.training_summary, {
    first_date: '2024-02-01', last_date: '2024-02-28', observed_days: 28,
    span_days: 28, missing_days: 0, age_days: 0,
  })
  assert.equal(result.forecast.length, 14)
  assert.equal(result.forecast[0].date, '2024-02-29')
  assert.equal(result.forecast.at(-1).date, '2024-03-13')
  assert.deepEqual(rows, before)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
})

for (const [name, rows, reason] of [
  ['empty', [], 'insufficient_history'], ['short', history().slice(0, 27), 'insufficient_history'],
  ['duplicate', [...history(), history()[0]], 'invalid_sales_data'],
  ['gap', history('2024-02-01', 29).filter((_, i) => i !== 20), 'missing_dates'],
  ['invalid units', history().map((r) => ({ ...r, units_sold: Infinity })), 'invalid_sales_data'],
  ['unsafe total', history().map((r) => ({ ...r, units_sold: Number.MAX_SAFE_INTEGER })), 'unsupported_numeric_range'],
]) {
  test(`does not invoke provider for ${name}`, async () => {
    const result = await make({ loadSales: async () => rows,
      provider: { predict: () => assert.fail('Must not call provider') } }).predict('P001')
    assert.equal(result.status, 'unavailable')
    assert.equal(result.reason, reason)
    assert.equal(result.model, null)
    assert.equal(result.interval, null)
    assert.deepEqual(result.forecast, [])
    if (reason === 'missing_dates') assert.equal(result.training_summary.missing_days, 1)
  })
}

for (const [name, options, reason] of [
  ['loader', { loadSales: async () => { throw new Error('private') } }, 'sales_load_failed'],
  ['provider', { provider: { predict: async () => { throw new Error('private') } } }, 'provider_failed'],
  ['preparation', { loadSales: async () => {
    const rows = history(); rows[Symbol.iterator] = () => { throw new Error('private') }; return rows
  } }, 'preparation_failed'],
]) {
  test(`${name} failure is sanitized`, async () => {
    const result = await make(options).predict('P001')
    assert.equal(result.reason, reason)
    assert.equal(result.status, 'unavailable')
    assert.deepEqual(result.forecast, [])
    assert.ok(!JSON.stringify(result).includes('private'))
  })
}

test('zero predictions are available; copied provider output has no private fields or aliases', async () => {
  let raw
  const service = make({ provider: { predict: async (r) => {
    raw = { ...prediction(r, 0), secret: 'private' }; return raw
  } } })
  const result = await service.predict('P001')
  assert.equal(result.status, 'available')
  assert.ok(result.forecast.every((r) => r.expected === 0))
  assert.ok(!JSON.stringify(result).includes('private'))
  raw.forecast[0].expected = 100
  assert.equal(result.forecast[0].expected, 0)
})
