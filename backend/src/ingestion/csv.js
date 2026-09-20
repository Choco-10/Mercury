import { CsvError, csvRecords } from './csv-records.js'

export const CSV_COLUMNS = {
  sales: ['date', 'product_id', 'price', 'units_sold', 'discount'],
  competitors: ['date', 'competitor_id', 'product_id', 'competitor_product_id', 'competitor_price', 'competitor_discount'],
}
export const MAX_ISSUES = 50
const idPattern = /^[A-Za-z0-9_-]{1,64}$/
const decimalPattern = /^\d+(?:\.\d+)?$/

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// Pure, browser-compatible normalization; no database or AWS imports.
export function normalizeCsv(text, type) {
  if (!Object.hasOwn(CSV_COLUMNS, type)) throw new CsvError('type must be "sales" or "competitors"', 400)
  const records = csvRecords(text)
  if (records.length < 2) throw new CsvError('CSV requires a header and at least one data row')
  const header = records[0]
  const required = CSV_COLUMNS[type]
  if (new Set(header).size !== header.length || header.some((name) => !name)) {
    throw new CsvError('CSV headers must be nonempty and unique')
  }
  const missing = required.filter((name) => !header.includes(name))
  const extra = header.filter((name) => !required.includes(name))
  if (missing.length || extra.length) {
    throw new CsvError('CSV columns do not match the schema', 422, [
      ...(missing.length ? [`Missing columns: ${missing.join(', ')}`] : []),
      ...(extra.length ? ['Unexpected columns; use the documented CSV schema'] : []),
    ])
  }
  const rows = []
  const issues = []
  const keys = new Set()
  for (let i = 1; i < records.length; i++) {
    const cells = records[i]
    const rowIssues = []
    const issue = (message) => rowIssues.push(`Record ${i + 1}: ${message}`)
    if (cells.length !== header.length) issue('field count does not match header')
    const record = Object.fromEntries(header.map((name, j) => [name, cells[j] || '']))
    const dateKey = 'date'
    if (!validDate(record[dateKey])) issue(`${dateKey} must be a real YYYY-MM-DD date`)
    if (!idPattern.test(record.product_id)) issue('invalid product_id (1–64 letters, digits, underscore or hyphen)')
    const numeric = type === 'sales'
      ? ['price', 'units_sold', 'discount']
      : ['competitor_price', 'competitor_discount']
    const values = {}
    for (const name of numeric) {
      const value = Number(record[name])
      values[name] = value
      if (!decimalPattern.test(record[name]) || !Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) {
        issue(`${name} must be a finite nonnegative decimal within the safe numeric range`)
      } else if (name === 'units_sold' && !Number.isSafeInteger(value)) issue('units_sold must be an integer')
      else if (name.endsWith('_price') && value <= 0) issue(`${name} must be positive`)
      else if (name === 'price' && value <= 0) issue('price must be positive')
      else if (name.endsWith('_discount') && value > 100) issue(`${name} must be between 0 and 100`)
    }
    if (type === 'competitors') {
      if (!idPattern.test(record.competitor_id)) issue('invalid competitor_id')
      if (!idPattern.test(record.competitor_product_id)) issue('invalid competitor_product_id')
    }
    const key = JSON.stringify([record.product_id, record[dateKey], ...(type === 'competitors' ? [record.competitor_id] : [])])
    if (keys.has(key)) issue('duplicate natural key within this file')
    keys.add(key)
    issues.push(...rowIssues.slice(0, MAX_ISSUES - issues.length))
    if (issues.length >= MAX_ISSUES) break
    if (!rowIssues.length) rows.push(type === 'sales'
      ? { date: record.date, product_id: record.product_id, ...values }
      : { date: record.date, product_id: record.product_id, competitor_id: record.competitor_id,
        competitor_product_id: record.competitor_product_id, ...values })
  }
  if (issues.length) throw new CsvError('CSV validation failed (up to 50 issues shown)', 422, issues)
  return rows
}

