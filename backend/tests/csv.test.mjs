import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCsv, CSV_COLUMNS } from '../src/ingestion/csv.js'
import { CsvError, MAX_CSV_BYTES, MAX_CSV_ROWS } from '../src/ingestion/csv-records.js'
const header = CSV_COLUMNS.sales.join(',')
const compHeader = CSV_COLUMNS.competitors.join(',')
const csv = (row) => `${header}\n${row}`

function rejects(text, type = 'sales', status = 422) {
  assert.throws(() => normalizeCsv(text, type), (err) => err instanceof CsvError && err.statusCode === status)
}

test('sales normalize BOM, reordered headers, whitespace, CRLF and zero units', () => {
  assert.deepEqual(normalizeCsv('\uFEFFprice, units_sold, product_id, date\r\n 100.50,0,P001,2024-02-29\r\n', 'sales'),
    [{ date: '2024-02-29', product_id: 'P001', units_sold: 0, price: 100.5 }])
})

test('competitor quoted commas, escaped quotes and newlines normalize cleanly', () => {
  const rows = normalizeCsv(`${compHeader}\n2026-09-01,P001,C001,"Speaker, ""Pro""\nEdition",100,4.5,10`, 'competitors')
  assert.deepEqual(rows, [{ observation_date: '2026-09-01', product_id: 'P001', competitor_id: 'C001',
    title: 'Speaker, "Pro"\nEdition', price: 100, rating: 4.5, discount: 10 }])
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), rows)
  assert.equal(Object.hasOwn(rows[0], 'units_sold'), false)
  assert.equal(Object.hasOwn(rows[0], 'date'), false)
})

for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '09/01/2026', '2026-09-01T00:00:00Z']) {
  test(`reject invalid date ${date}`, () => rejects(csv(`${date},P001,1,100`)))
}
for (const units of ['', '-1', '1.5', 'NaN', 'Infinity', '1e3', '0x10', '9007199254740992']) {
  test(`reject invalid units ${units}`, () => rejects(csv(`2026-09-01,P001,${units},100`)))
}
for (const price of ['', '0', '-1', 'NaN', 'Infinity', '1e309', '0xFF']) {
  test(`reject invalid price ${price}`, () => rejects(csv(`2026-09-01,P001,1,${price}`)))
}
for (const text of [
  header, 'date,product_id,price\n2026-09-01,P001,100',
  `${header},extra\n2026-09-01,P001,1,100,x`,
  'date,date,units_sold,price\n2026-09-01,P001,1,100',
  csv('2026-09-01,P001,1'), csv('2026-09-01,P001,1,100,extra'),
  csv('2026-09-01,,1,100'), csv('2026-09-01,P#001,1,100'),
  csv('2026-09-01,"P001,1,100'), csv('2026-09-01,"P001"x,1,100'),
  csv('2026-09-01,P"001,1,100'),
]) {
  test(`reject invalid schema/CSV ${text.slice(0, 45)}`, () => rejects(text))
}
for (const row of [
  '2026-09-01,P001,C001,Title,100,5.1,0',
  '2026-09-01,P001,C001,Title,100,4,101',
  '2026-09-01,P001,C001,,100,4,0',
  '2026-09-01,P001,,Title,100,4,0',
]) {
  test(`reject competitor range/required fields ${row}`, () => rejects(`${compHeader}\n${row}`, 'competitors'))
}

test('duplicate natural keys rejected; same date for different IDs allowed', () => {
  rejects(csv('2026-09-01,P001,1,100\n2026-09-01,P001,2,200'))
  assert.equal(normalizeCsv(csv('2026-09-01,P001,1,100\n2026-09-01,P002,2,200'), 'sales').length, 2)
  const row = '2026-09-01,P001,C001,Title,100,4,0'
  rejects(`${compHeader}\n${row}\n${row}`, 'competitors')
})

test('byte and row limits enforced, including UTF-8 multibyte input', () => {
  rejects('a'.repeat(MAX_CSV_BYTES + 1), 'sales', 413)
  rejects('₹'.repeat(Math.floor(MAX_CSV_BYTES / 3) + 1), 'sales', 413)
  rejects(`${header}\n${'2026-09-01,P001,1,100\n'.repeat(MAX_CSV_ROWS + 1)}`, 'sales', 413)
})

test('at most 50 issues returned without partial normalized output', () => {
  assert.throws(() => normalizeCsv(`${header}\n${'bad,,bad,bad\n'.repeat(100)}`, 'sales'),
    (err) => err.issues.length === 50)
})

test('empty content and unknown dataset type are client errors', () => {
  rejects('', 'sales', 400)
  rejects(csv('2026-09-01,P001,1,100'), 'inventory', 400)
})
