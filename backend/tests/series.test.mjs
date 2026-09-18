import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { prepareDailySeries as prepare, addDaysUTC as add, diffDaysUTC, parseUTCDate } from '../../shared/series.js'
import * as packaged from '../src/shared/series.js'

const history = (n = 28, value = (i) => i) => Array.from({ length: n }, (_, i) => ({
  date: add('2024-02-01', i), units_sold: value(i),
}))


test('invalid rows and unsafe totals', () => {
  assert.equal(prepare(null).reason, 'invalid_sales_data')
  for (const units of [NaN, Infinity, -1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) {
    const rows = history(); rows[0].units_sold = units
    assert.equal(prepare(rows).reason, 'invalid_sales_data')
  }
  for (const row of [null, [], { date: '2024-02-30', units_sold: 1 }, { date: '2024-02-01', units_sold: 1, product_id: 'OTHER' }]) {
    assert.equal(prepare([row, ...history().slice(1)], { expectedProductId: 'P001' }).reason, 'invalid_sales_data')
  }
  assert.equal(prepare([...history(), history()[0]]).reason, 'invalid_sales_data')
  const rows = history(28, () => 0)
  rows[0].units_sold = Number.MAX_SAFE_INTEGER
  assert.equal(prepare(rows).ok, true)
  rows[1].units_sold = 1
  assert.equal(prepare(rows).reason, 'unsupported_numeric_range')
})
test('explicit staleness never changes observation dates', () => {
  for (const [today, age] of [['2024-03-01', 2], ['2024-02-28', 0], ['2024-02-27', -1]]) {
    const { series } = prepare(history(), { today })
    assert.equal(series.stalenessDays, age)
    assert.equal(series.futureDated, age < 0)
    assert.equal(series.lastDate, '2024-02-28')
  }
  assert.equal(prepare(history()).series.stalenessDays, null)
  assert.equal(prepare(history()).series.futureDated, null)
})
test('identical UTC, India and DST timezone results', () => {
  const url = new URL('../../shared/series.js', import.meta.url).href
  const script = `import { prepareDailySeries, addDaysUTC } from ${JSON.stringify(url)};
    const rows = Array.from({length: 40}, (_, i) => ({date: addDaysUTC('2026-03-01', i), units_sold: i % 7}));
    console.log(JSON.stringify(prepareDailySeries(rows, {today: '2026-04-15'})));`
  const outputs = ['UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/Berlin'].map((TZ) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ } })
    assert.equal(child.status, 0, child.stderr)
    return child.stdout
  })
  outputs.forEach((output) => assert.equal(output, outputs[0]))
})


for (const [origin, end] of [['2024-02-20', '2024-03-05'], ['2023-02-20', '2023-03-06'], ['2026-12-25', '2027-01-08'], ['2026-04-25', '2026-05-09'], ['2026-03-01', '2026-03-15'], ['2026-10-25', '2026-11-08']]) {
  test(`14 consecutive UTC dates after ${origin}`, () => {
    const dates = Array.from({ length: 14 }, (_, i) => add(origin, i + 1))
    assert.equal(new Set(dates).size, 14)
    assert.equal(dates.at(-1), end)
    dates.forEach((date, i) => assert.equal(diffDaysUTC(origin, date), i + 1))
  })
}
test('strict dates and arithmetic bounds', () => {
  for (const date of ['2023-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '2026-01-01T00:00:00.000Z', '', null]) assert.throws(() => parseUTCDate(date), RangeError)
  for (const days of [NaN, Infinity, 0.5, '1', Number.MAX_SAFE_INTEGER]) assert.throws(() => add('2026-01-01', days), RangeError)
  assert.throws(() => add('9999-12-31', 1), RangeError)
  assert.throws(() => add('0000-01-01', -1), RangeError)
  assert.equal(add('2024-03-01', -1), '2024-02-29')
})
test('frozen inputs are sorted without mutation or output aliases; reproducible packaged parity', () => {
  const rows = Object.freeze(history().reverse().map(Object.freeze))
  const before = structuredClone(rows)
  const result = prepare(rows)
  assert.deepEqual(result, prepare(rows))
  assert.deepEqual(result, packaged.prepareDailySeries(rows))
  assert.deepEqual(result.series.units, Array.from({ length: 28 }, (_, i) => i))
  result.series.records[0].units_sold = 99
  assert.deepEqual(rows, before)
})
for (const [name, value] of [['zero', () => 0], ['constant', () => 10], ['trend', (i) => i], ['weekly', (i) => i % 7], ['intermittent', (i) => i % 9 === 0 ? 5 : 0]]) {
  test(`${name} observations preserved without modeling`, () => {
    const rows = history(28, value)
    const { series, ok } = prepare(rows)
    assert.equal(ok, true)
    assert.deepEqual(series.units, rows.map((r) => r.units_sold))
    assert.equal(series.flags.meetsMinimumHistory, true)
    assert.equal(series.missingDays, 0)
  })
}
test('short history and options', () => {
  for (const n of [0, 1, 3, 27]) assert.equal(prepare(history(n)).reason, 'insufficient_history')
  assert.equal(prepare(history(3), { minimum: 1 }).series.flags.meetsMinimumHistory, false)
  for (const options of [{ minimum: 0 }, { minimum: Infinity }, { today: 'bad' }, { expectedProductId: 1 }]) assert.throws(() => prepare(history(), options), TypeError)
})
test('late gaps and multiple gaps, not zero filling', () => {
  const rows = history(31).filter((_, i) => ![2, 27, 29].includes(i))
  const { series } = prepare(rows)
  assert.equal(series.observedDays, 28)
  assert.equal(series.spanDays, 31)
  assert.equal(series.missingDays, 3)
  assert.deepEqual(series.gapSample, ['2024-02-03', '2024-02-28', '2024-03-01'])
  assert.equal(series.gapsTruncated, false)
  assert.equal(series.flags.meetsMinimumHistory, false)
  assert.deepEqual(series.units, rows.map((r) => r.units_sold))
})
test('centuries of missing dates have bounded samples', () => {
  const rows = ['1000-01-01', '9000-01-01'].map((date) => ({ date, units_sold: 0 }))
  const { series } = prepare(rows, { minimum: 1 })
  assert.equal(series.gapSample.length, 500)
  assert.equal(series.gapsTruncated, true)
  assert.equal(series.missingDays, diffDaysUTC(rows[0].date, rows[1].date) - 1)
  assert.equal(series.gapSample.at(-1), add(rows[0].date, 500))
})
