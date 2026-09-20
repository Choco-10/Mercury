/**
 * Inference feature engineering for the pricing workflow (ai.md §7/§16/§18).
 *
 * Mirrors inference/feature_engineering.py line for line; the shared contract keeps
 * the feature order and the history minimum identical in both implementations.
 *
 * Invariants enforced here:
 *   - seller history is validated against the ai.md §14 schema (date, product_id,
 *     price, units_sold, discount) whether it arrives from S3 or DynamoDB
 *   - the model is PRODUCT-AGNOSTIC: no per-product mappings exist or are needed —
 *     every product with enough history is supported (the rolling 7d/30d averages
 *     carry the product's own demand scale)
 *   - `sales_7d_avg`/`sales_30d_avg` use prior days only (§8)
 *   - competitor rows are parsed for Bedrock context only and never enter a feature row
 */
import { csvRecords } from '../../ingestion/csv-records.js'
import { CONTRACT, FEATURES, MIN_HISTORY_DAYS, PricingError } from './contract.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function validDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function rowsFromCsv(text, type) {
  const records = csvRecords(text)
  if (records.length < 2) {
    throw new PricingError(`${type} CSV requires a header and at least one data row`, 'invalid_input')
  }
  const header = records[0]
  const required = type === 'sales' ? CONTRACT.sales_columns : CONTRACT.competitor_columns
  if (new Set(header).size !== header.length || header.some((name) => !name)) {
    throw new PricingError(`${type} CSV headers must be nonempty and unique`, 'invalid_input')
  }
  const missing = required.filter((name) => !header.includes(name))
  if (missing.length) {
    throw new PricingError(
      `${type} CSV is missing the ${missing.join(', ')} column(s) (ai.md §${type === 'sales' ? 14 : 15})`,
      'invalid_input')
  }
  return records.slice(1).map((cells) => Object.fromEntries(
    header.map((name, index) => [name, cells[index] ?? ''])))
}

/** Parse + validate the seller sales schema (ai.md §14). */
export function parseSalesCsv(text) {
  const rows = rowsFromCsv(text, 'sales').map((record) => {
    const price = Number(record.price)
    const units = Number(record.units_sold)
    if (!validDate(record.date) || !(price > 0) || !Number.isSafeInteger(units) || units < 0) {
      throw new PricingError(
        'sales rows require a real YYYY-MM-DD date, a positive price and nonnegative integer units',
        'invalid_input')
    }
    return { date: record.date, product_id: String(record.product_id).trim(), price, units_sold: units }
  })
  return assertNoDuplicateDates(rows)
}

/** Parse + validate the competitor schema (ai.md §15). */
export function parseCompetitorsCsv(text) {
  return rowsFromCsv(text, 'competitors').map((record) => {
    const price = Number(record.competitor_price)
    if (!validDate(record.date) || !(price > 0)) {
      throw new PricingError(
        'competitor rows require a real YYYY-MM-DD date and a positive competitor_price',
        'invalid_input')
    }
    return {
      date: record.date,
      competitor_id: String(record.competitor_id).trim(),
      product_id: String(record.product_id).trim(),
      competitor_product_id: String(record.competitor_product_id ?? '').trim(),
      competitor_price: price,
      competitor_discount: Number(record.competitor_discount || 0),
    }
  })
}

function assertNoDuplicateDates(rows) {
  const seen = new Set()
  for (const row of rows) {
    const key = `${row.product_id}|${row.date}`
    if (seen.has(key)) {
      throw new PricingError(
        `duplicate seller history for ${row.product_id} on ${row.date}`, 'invalid_history')
    }
    seen.add(key)
  }
  return rows
}

/** Validate store (DynamoDB) sales rows without re-parsing CSV text. */
export function normalizeStoreSales(rows, productId) {
  if (!Array.isArray(rows)) return []
  return assertNoDuplicateDates(rows.map((row) => {
    const price = Number(row.price)
    const units = Number(row.units_sold)
    if (!validDate(row.date) || !(price > 0) || !Number.isSafeInteger(units) || units < 0) {
      throw new PricingError(
        'stored sales rows require a real date, a positive price and nonnegative integer units',
        'invalid_history')
    }
    return { date: row.date, product_id: String(row.product_id ?? productId).trim(), price, units_sold: units }
  }))
}

/** Latest observation per competitor_id for one product (ai.md §15). */
export function latestCompetitors(rows, productId) {
  const byId = new Map()
  for (const row of rows ?? []) {
    if (String(row.product_id) !== String(productId)) continue
    const current = byId.get(row.competitor_id)
    if (!current || row.date > current.date) byId.set(row.competitor_id, row)
  }
  return [...byId.values()].sort((a, b) => a.competitor_id.localeCompare(b.competitor_id))
}

function sortedHistory(sales, productId) {
  const rows = (sales ?? []).filter((row) => String(row.product_id) === String(productId))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!rows.length) {
    throw new PricingError(
      `no seller history for product ${productId}`, 'no_seller_history')
  }
  return rows
}

/**
 * The latest inference feature row (ai.md §7/§16) plus the context the agents need.
 *
 * The inference date is the seller's latest recorded day, so `day_of_week`/`month`
 * describe that day. `sales_7d_avg`/`sales_30d_avg` exclude it (prior days only, §8),
 * exactly like the training features.
 */
export function latestInferenceFeatures(sales, productId, {
  historySummary, minHistoryDays = MIN_HISTORY_DAYS,
} = {}) {
  const history = sortedHistory(sales, productId)
  if (!history.length) {
    throw new PricingError(`no seller history for product ${productId}`, 'no_seller_history')
  }
  const latest = history[history.length - 1]
  const prior = history.slice(0, -1)
  if (prior.length < minHistoryDays) {
    throw new PricingError(
      `at least ${minHistoryDays + 1} daily seller records are required `
      + `(${minHistoryDays} prior days + the latest day); got ${history.length}`,
      'insufficient_history')
  }

  const [year, month, day] = latest.date.split('-').map(Number)
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // Sunday = 0
  const currentPrice = Number(latest.price)
  const previousPrice = Number(prior[prior.length - 1].price)
  const units = prior.map((row) => row.units_sold)

  // Product-agnostic feature row (ai.md §7): no product_id/category — the rolling
  // averages carry the product's own demand scale, so the same model generalizes.
  const features = {
    price: currentPrice,
    day_of_week: (dayOfWeek + 6) % 7, // Monday = 0, as in training (ai.md §7)
    month,
    sales_7d_avg: units.slice(-7).reduce((sum, value) => sum + value, 0) / 7,
    sales_30d_avg: units.slice(-30).reduce((sum, value) => sum + value, 0) / 30,
    // Current + previous price only (ai.md §7); replaced per candidate in §18.
    price_change_percent: previousPrice
      ? ((currentPrice - previousPrice) / previousPrice) * 100 : 0,
    // M5 calendar/event flags cover 2011-2016 only; seller uploads sit outside that
    // calendar, so no event applies. The value is never invented (ai.md §7).
    event: 0,
  }

  return {
    product_id: productId,
    features,
    inference_date: latest.date,
    current_price: currentPrice,
    previous_price: previousPrice,
    history_days: history.length,
    last_units: Number(latest.units_sold),
    history_summary: historySummary
      ? historySummary(history)
      : summarizeHistory(history),
  }
}

/** Demand context for the Market Analyst agent — supplied numbers only (ai.md §22). */
export function summarizeHistory(history) {
  const units = history.map((row) => row.units_sold)
  const prices = history.map((row) => row.price)
  const mean = (values) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const round = (value) => Math.round(value * 1000) / 1000
  return {
    days: history.length,
    first_date: history[0].date,
    last_date: history[history.length - 1].date,
    mean_units: round(mean(units)),
    last7_units_avg: round(mean(units.slice(-7))),
    last30_units_avg: round(mean(units.slice(-30))),
    last_units: units[units.length - 1],
    price_min: Math.min(...prices),
    price_max: Math.max(...prices),
  }
}

/** One candidate row (ai.md §18): replace `price`, recompute the price change. */
export function candidateFeatures(base, candidatePrice, currentPrice) {
  return {
    ...base,
    price: candidatePrice,
    price_change_percent: currentPrice
      ? ((candidatePrice - currentPrice) / currentPrice) * 100 : 0,
  }
}

/** One text/csv row: nine numeric values in contract order (ai.md §13). */
export function endpointPayload(features, contract = CONTRACT) {
  return FEATURES.map((name) => Number(features[name]).toFixed(6)).join(contract.endpoint.delimiter)
}

