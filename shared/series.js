/**
 * Daily-series preparation shared by forecasting consumers (backend and browser).
 * Pure UTC calendar arithmetic: no local-time date methods, no input mutation,
 * no imputation. Zeros are observed sales, not missing data. NO LLM involvement.
 *
 * This module reports facts about a series. It does NOT decide forecast
 * availability policy; consumers own that decision explicitly.
 */

/** Provisional eligibility: 28 consecutive observed days, not accuracy evidence. */
export const MIN_FORECAST_HISTORY = 28
/** Upper bound on enumerated missing dates returned in diagnostics. */
const MAX_ENUMERATED_GAPS = 500

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86400000

/** True for a real calendar date written exactly as YYYY-MM-DD (no timestamps). */
export function isValidUTCTextDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  const time = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

/** Midnight-UTC epoch milliseconds for a YYYY-MM-DD string. */
export function parseUTCDate(value) {
  if (!isValidUTCTextDate(value)) throw new RangeError('Expected a real YYYY-MM-DD date')
  return Date.parse(`${value}T00:00:00.000Z`)
}

/** Calendar date exactly `days` after a YYYY-MM-DD string (month/year/leap safe). */
export function addDaysUTC(value, days) {
  if (!Number.isSafeInteger(days)) throw new RangeError('Days must be a safe integer')
  const time = parseUTCDate(value) + days * DAY_MS
  if (!Number.isSafeInteger(time) || Math.abs(time) > 8640000000000000) {
    throw new RangeError('Date arithmetic exceeds the supported range')
  }
  const result = new Date(time).toISOString().slice(0, 10)
  if (!isValidUTCTextDate(result)) throw new RangeError('Date must remain within four-digit years')
  return result
}

/** Whole-day difference b − a for two YYYY-MM-DD strings. */
export function diffDaysUTC(a, b) {
  return Math.round((parseUTCDate(b) - parseUTCDate(a)) / DAY_MS)
}

function unavailable(reason, issues) {
  return { ok: false, reason, issues, series: null }
}

/**
 * Validate and prepare a daily sales series without mutating the input.
 * Returns { ok, reason, issues, series } where series holds aligned, ascending
 * UTC calendar dates and units, plus factual coverage diagnostics.
 */
export function prepareDailySeries(rows, {
  minimum = MIN_FORECAST_HISTORY,
  expectedProductId = null,
  today = null,
} = {}) {
  if (!Number.isSafeInteger(minimum) || minimum < 1) throw new TypeError('minimum must be a positive safe integer')
  if (today !== null && !isValidUTCTextDate(today)) throw new TypeError('today must be a real UTC date')
  if (expectedProductId !== null && (typeof expectedProductId !== 'string' || !expectedProductId)) {
    throw new TypeError('expectedProductId must be a nonempty string')
  }
  if (!Array.isArray(rows)) {
    return unavailable('invalid_sales_data', ['Sales history must be an array'])
  }
  if (rows.length < minimum) {
    return unavailable('insufficient_history',
      [`At least ${minimum} daily sales record(s) are required`])
  }
  let total = 0
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        !isValidUTCTextDate(row.date) ||
        !Number.isSafeInteger(row.units_sold) || row.units_sold < 0 ||
        (expectedProductId != null && row.product_id != null && row.product_id !== expectedProductId)) {
      return unavailable('invalid_sales_data',
        ['Sales require real YYYY-MM-DD dates, nonnegative safe-integer units, and matching product IDs'])
    }
    if (row.units_sold > Number.MAX_SAFE_INTEGER - total) {
      return unavailable('unsupported_numeric_range', ['Total observed units exceed safe integer precision'])
    }
    total += row.units_sold
  }
  const unique = new Set(rows.map((row) => row.date))
  if (unique.size !== rows.length) {
    return unavailable('invalid_sales_data', ['Sales must contain at most one record per date'])
  }

  // Sort a copy; never mutate the caller's array or rows.
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const dates = ordered.map((row) => row.date)
  const units = ordered.map((row) => row.units_sold)
  const firstDate = dates[0]
  const lastDate = dates[dates.length - 1]
  const spanDays = diffDaysUTC(firstDate, lastDate) + 1
  const missingDays = spanDays - dates.length

  const gapSample = []
  // Walk adjacent observations; cap enumeration even for histories spanning centuries.
  for (let i = 1; i < dates.length && gapSample.length < MAX_ENUMERATED_GAPS; i++) {
    const gap = diffDaysUTC(dates[i - 1], dates[i]) - 1
    const count = Math.min(gap, MAX_ENUMERATED_GAPS - gapSample.length)
    for (let j = 1; j <= count; j++) gapSample.push(addDaysUTC(dates[i - 1], j))
  }
  const gapsTruncated = missingDays > gapSample.length

  const stalenessDays = today != null
    ? (isValidUTCTextDate(today) ? diffDaysUTC(lastDate, today) : null)
    : null

  return {
    ok: true,
    reason: null,
    issues: [],
    series: {
      // Factual coverage; availability policy is a consumer decision.
      dates,
      units,
      records: ordered.map((row) => ({ date: row.date, units_sold: row.units_sold })),
      observedDays: dates.length,
      spanDays,
      missingDays,
      gapSample,
      gapsTruncated,
      firstDate,
      lastDate,
      stalenessDays,
      futureDated: today === null ? null : stalenessDays < 0,
      flags: {
        meetsMinimumHistory: dates.length >= MIN_FORECAST_HISTORY && missingDays === 0,
        completeDailyCoverage: missingDays === 0,
      },
    },
  }
}
