import { randomUUID } from 'node:crypto'
import { buildAnalysis } from './analysis.js'

export class AnalysisDataError extends Error {
  constructor(issues) {
    super('Analysis requires valid sales and competitor data')
    this.issues = issues
  }
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function assertFiniteNumbers(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Analysis calculation produced a non-finite number')
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) assertFiniteNumbers(entry)
  }
}

// Input guards shared by GET /analysis and POST /analyze; do not change the baseline model.
export function validateAnalysisInputs(product, sales, competitors) {
  const issues = []
  if (!Number.isFinite(product.price) || product.price <= 0) {
    issues.push('Product price must be finite and positive')
  }
  if (!Array.isArray(sales) || sales.length < 3) {
    issues.push('At least three daily sales records are required')
  }
  if (Array.isArray(sales)) {
    const dates = new Set()
    for (const row of sales) {
      if (!row || !validDate(row.date) ||
          !Number.isSafeInteger(row.units_sold) || row.units_sold < 0 ||
          (row.product_id != null && row.product_id !== product.product_id)) {
        issues.push('Sales must have valid YYYY-MM-DD dates, nonnegative integer units, and matching product IDs')
        break
      }
      if (dates.has(row.date)) {
        issues.push('Sales must contain at most one record per date')
        break
      }
      dates.add(row.date)
    }
  }
  if (!Array.isArray(competitors) || competitors.length === 0) {
    issues.push('At least one competitor observation is required')
  } else if (competitors.some((row) => !row ||
      !Number.isFinite(row.price) || row.price <= 0 ||
      (row.product_id != null && row.product_id !== product.product_id))) {
    issues.push('Competitor prices must be finite and positive, with matching product IDs')
  }
  if (issues.length) throw new AnalysisDataError(issues)
}

export function computeAnalysis(product, sales, competitors) {
  validateAnalysisInputs(product, sales, competitors)
  const sortedSales = [...sales].sort((a, b) => a.date.localeCompare(b.date))
  const analysis = buildAnalysis(product, sortedSales, competitors)
  assertFiniteNumbers(analysis)
  return analysis
}

export function createAnalysisSnapshot(product, sales, competitors) {
  return { ...computeAnalysis(product, sales, competitors), analysis_id: randomUUID() }
}
