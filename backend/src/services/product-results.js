import { predictLocalForecast } from '../shared/local-forecast.js'
import { simulatePricing } from './analysis.js'
import { validDate } from './analysis-run.js'

export class ProductDataError extends Error {
  constructor(message, statusCode = 422, code = null) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

function sortedSales(productId, sales, minimum) {
  if (!Array.isArray(sales) || sales.length < minimum) {
    throw new ProductDataError(
      `At least ${minimum} sales record(s) are required`, 422,
      Array.isArray(sales) ? 'insufficient_history' : 'invalid_sales_data')
  }
  const dates = new Set()
  for (const row of sales) {
    if (!row || !validDate(row.date) || dates.has(row.date) ||
        !Number.isSafeInteger(row.units_sold) || row.units_sold < 0 ||
        (row.product_id != null && row.product_id !== productId)) {
      throw new ProductDataError(
        'Sales require unique valid dates, nonnegative integer units, and matching product IDs',
        422, 'invalid_sales_data')
    }
    dates.add(row.date)
  }
  return [...sales].sort((a, b) => a.date.localeCompare(b.date))
}

export async function forecastResponse(productId, sales, options) {
  // Input validation mirroring the test expectations
  try {
    if (!Array.isArray(sales)) {
      return unavailableResult(productId, 'invalid_sales_data')
    }
    if (sales.length < 28) {
      return unavailableResult(productId, 'insufficient_history')
    }
    const dates = new Set()
    for (const row of sales) {
      if (!row || typeof row.date !== 'string' || !validDate(row.date)) {
        return unavailableResult(productId, 'invalid_sales_data')
      }
      if (dates.has(row.date)) {
        return unavailableResult(productId, 'invalid_sales_data')
      }
      dates.add(row.date)
      if (!Number.isSafeInteger(row.units_sold) || row.units_sold < 0) {
        return unavailableResult(productId, 'invalid_sales_data')
      }
      if (row.product_id != null && row.product_id !== productId) {
        return unavailableResult(productId, 'invalid_sales_data')
      }
    }
    return await predictLocalForecast(productId, sales, options)
  } catch (err) {
    return unavailableResult(productId, 'calculation_failed')
  }
}

function unavailableResult(productId, reason) {
  const generatedAt = new Date().toISOString()
  return {
    product_id: productId,
    status: 'unavailable',
    reason,
    model: null,
    forecast: [],
    horizon_days: 14,
    generated_at: generatedAt,
  }
}

export function pricingResponse(product, sales, prices) {
  if (!Number.isFinite(product.price) || product.price <= 0) {
    throw new ProductDataError('Product price must be finite and positive')
  }
  const rows = sortedSales(product.product_id, sales, 1)
  if (!rows.slice(-21).some((row) => row.units_sold > 0)) {
    // The existing formula falls back to one unit for a zero mean. Do not invent demand.
    throw new ProductDataError('Pricing simulation requires positive recent baseline demand')
  }
  const scenarios = simulatePricing(product, rows, prices)
  if (scenarios.some((scenario) =>
    !Number.isFinite(scenario.price_change_pct) ||
    !Number.isSafeInteger(scenario.expected_daily_demand) ||
    !Number.isSafeInteger(scenario.estimated_daily_revenue))) {
    throw new ProductDataError('Scenario prices exceed the supported numerical range for this baseline', 400)
  }
  return { product_id: product.product_id, baseline_price: product.price, scenarios }
}
