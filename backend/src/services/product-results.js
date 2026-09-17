import { forecastSeries } from '../shared/analytics.js'
import { simulatePricing } from './analysis.js'
import { validDate, assertFiniteNumbers } from './analysis-run.js'

export class ProductDataError extends Error {
  constructor(message, statusCode = 422) {
    super(message)
    this.statusCode = statusCode
  }
}

function sortedSales(productId, sales, minimum) {
  if (!Array.isArray(sales) || sales.length < minimum) {
    throw new ProductDataError(`At least ${minimum} sales record(s) are required`)
  }
  const dates = new Set()
  for (const row of sales) {
    if (!row || !validDate(row.date) || dates.has(row.date) ||
        !Number.isSafeInteger(row.units_sold) || row.units_sold < 0 ||
        (row.product_id != null && row.product_id !== productId)) {
      throw new ProductDataError('Sales require unique valid dates, nonnegative integer units, and matching product IDs')
    }
    dates.add(row.date)
  }
  return [...sales].sort((a, b) => a.date.localeCompare(b.date))
}

export function forecastResponse(productId, sales) {
  const response = {
    product_id: productId, model: null, generated_at: new Date().toISOString(),
    horizon_days: 14, forecast: [],
  }
  try {
    const rows = sortedSales(productId, sales, 3)
    const forecast = forecastSeries(rows.map((s) => s.date), rows.map((s) => s.units_sold), 14)
    assertFiniteNumbers(forecast)
    return { ...response, model: 'trend+weekly-seasonality (lambda baseline)', forecast }
  } catch {
    // Optional forecast unavailability must not invalidate product/sales reads.
    return response
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
