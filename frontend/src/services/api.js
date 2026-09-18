/** Adapter modes: local = browser demo; localhost/aws = same backend HTTP client.
 * AWS integration, agent implementation and full demo parity remain separately verified work.
 */
import { createHttpClient } from './http.js'
import { getDemoDataset } from '../data/demoData.js'
import { predictLocalForecast, summarizeForecast } from '../../../shared/local-forecast.js'
import {
  classifyTrend,
  linearTrendSlope,
  mean,
  median,
} from '../../../shared/analytics.js'

export const API_MODE = import.meta.env?.VITE_API_MODE || 'local'
const { get: httpGet, post: httpPost } = createHttpClient({
  mode: API_MODE, baseUrl: import.meta.env?.VITE_API_BASE_URL || '',
})
const USE_HTTP = API_MODE !== 'local'

export function uploadCsv(type, csv) {
  return httpPost('/data/upload', { type, csv })
}

export function fetchUploadOutcome(uploadId) {
  return httpGet(`/data/uploads/${encodeURIComponent(uploadId)}`)
}

function localDelay(ms = 120) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Latest competitor observation per competitor for a product. */
export function latestCompetitors(dataset, productId) {
  const byId = {}
  for (const row of dataset.competitors[productId] || []) {
    if (!byId[row.competitor_id] || row.observation_date > byId[row.competitor_id].observation_date) {
      byId[row.competitor_id] = row
    }
  }
  return Object.values(byId)
}

/**
 * Deterministic competitor metrics — application code, NOT the LLM.
 */
export function competitorMetrics(product, competitors) {
  const prices = competitors.map((c) => c.price)
  const avg = mean(prices)
  const med = median(prices)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const seller = product.price
  return {
    competitor_avg_price: Math.round(avg),
    competitor_median_price: Math.round(med),
    competitor_min_price: min,
    competitor_max_price: max,
    seller_price: seller,
    seller_position:
      seller > max ? 'above_all' : seller < min ? 'below_all' : 'within_range',
    seller_vs_median_pct: med ? Math.round(((seller - med) / med) * 1000) / 10 : 0,
  }
}

/**
 * Deterministic pricing what-if simulation (local mode).
 * Demand elasticity: every 1% price decrease lifts expected daily demand
 * by elasticityPct (capped), based on recent baseline demand.
 */
export function simulatePricing(product, salesHistory, scenarioPrices, elasticityPct = 1.4) {
  const recent = salesHistory.slice(-21)
  const baseUnits = mean(recent.map((s) => s.units_sold)) || 1
  const basePrice = product.price
  return scenarioPrices.map((price) => {
    const priceDeltaPct = ((price - basePrice) / basePrice) * 100
    const demandDeltaPct = -priceDeltaPct * elasticityPct
    const expectedDemand = Math.max(0, Math.round(baseUnits * (1 + demandDeltaPct / 100)))
    return {
      price,
      price_change_pct: Math.round(priceDeltaPct * 10) / 10,
      expected_daily_demand: expectedDemand,
      estimated_daily_revenue: Math.round(expectedDemand * price),
      competitor_position:
        price < basePrice * 0.97 ? 'undercutting' : price > basePrice * 1.03 ? 'premium' : 'at_par',
    }
  })
}

// =====================================================================
// Public API — same signatures in local and aws mode.
// =====================================================================

/** GET /api/products */
export async function fetchProducts() {
  if (USE_HTTP) return httpGet('/products')
  await localDelay()
  const ds = getDemoDataset()
  return ds.products
}

/** GET /api/products/{id} */
export async function fetchProduct(productId) {
  if (USE_HTTP) return httpGet(`/products/${productId}`)
  await localDelay()
  const ds = getDemoDataset()
  const product = ds.products.find((p) => p.product_id === productId)
  if (!product) throw new Error(`Product ${productId} not found`)
  return product
}

/** GET /api/products/{id}/sales */
export async function fetchSalesHistory(productId) {
  if (USE_HTTP) return httpGet(`/products/${productId}/sales`)
  await localDelay()
  const ds = getDemoDataset()
  return ds.sales_history[productId] || []
}

/** GET /api/products/{id}/competitors */
export async function fetchCompetitors(productId) {
  if (USE_HTTP) return httpGet(`/products/${productId}/competitors`)
  await localDelay()
  const ds = getDemoDataset()
  return latestCompetitors(ds, productId)
}

/**
 * GET /api/products/{id}/forecast
 * HTTP modes use the backend statistical baseline. No SageMaker invocation
 * is enabled by selecting an HTTP adapter.
 */
export async function fetchForecast(productId) {
  if (USE_HTTP) return httpGet(`/products/${productId}/forecast`)
  await localDelay(200)
  const ds = getDemoDataset()
  const sales = ds.sales_history[productId] || []
  return predictLocalForecast(productId, sales)
}

/** POST /api/products/{id}/simulate-price */
export async function simulatePrice(productId, scenarioPrices) {
  if (USE_HTTP)
    return httpPost(`/products/${productId}/simulate-price`, { scenario_prices: scenarioPrices })
  await localDelay()
  const ds = getDemoDataset()
  const product = ds.products.find((p) => p.product_id === productId)
  return {
    product_id: productId,
    baseline_price: product.price,
    scenarios: simulatePricing(product, ds.sales_history[productId], scenarioPrices),
  }
}

/** GET /api/products/{id}/analysis — recommendation + metrics bundle */
export async function fetchAnalysis(productId) {
  if (USE_HTTP) return httpGet(`/products/${productId}/analysis`)
  await localDelay(250)
  const ds = getDemoDataset()
  const product = ds.products.find((p) => p.product_id === productId)
  const sales = ds.sales_history[productId] || []
  const comps = latestCompetitors(ds, productId)
  const metrics = competitorMetrics(product, comps)
  const trend = classifyTrend(sales.map((s) => s.units_sold))
  const slope = linearTrendSlope(sales.slice(-30).map((s) => s.units_sold))
  const forecast = await predictLocalForecast(productId, sales)
  const summary = summarizeForecast(forecast, sales.slice(-14).map((s) => s.units_sold))

  return {
    product_id: productId,
    generated_at: new Date().toISOString(),
    competitor_metrics: metrics,
    demand: { trend: trend.direction, change_pct: trend.changePct, slope_30d: Math.round(slope * 100) / 100 },
    forecast_summary: summary,
    recommendation: buildRecommendation({
      competitor_metrics: metrics,
      demand: { trend: trend.direction, change_pct: trend.changePct, slope_30d: Math.round(slope * 100) / 100 },
      forecast_summary: summary,
    }),
  }
}


/**
 * Deterministic recommendation engine (local mode preview).
 * Combines competitor metrics, demand trend and forecast into a
 * structured recommendation. Never uses an LLM. In AWS mode this is
 * produced by the Lambda recommendation service with the same shape.
 */
export function buildRecommendation({ competitor_metrics: cm, demand, forecast_summary: fs }) {
  const reasons = []
  let score = 0

  if (cm.seller_vs_median_pct > 3) {
    score += 2
    reasons.push(`seller price is ${cm.seller_vs_median_pct}% above competitor median (₹${cm.competitor_median_price})`)
  } else if (cm.seller_vs_median_pct < -5) {
    score += 1
    reasons.push(`seller price is ${Math.abs(cm.seller_vs_median_pct)}% below competitor median — margin review possible`)
  }
  if (demand.trend === 'decreasing') {
    score += 2
    reasons.push(`demand declined ${Math.abs(demand.change_pct)}% recently`)
  }
  if (fs.delta_vs_recent_pct != null && fs.delta_vs_recent_pct < -10) {
    score += 1
    reasons.push(`14-day forecast indicates demand easing (~${Math.abs(fs.delta_vs_recent_pct)}% lower)`)
  }
  if (demand.trend === 'increasing' && cm.seller_vs_median_pct <= 0) {
    score += 0
    reasons.push('demand is rising while price is at/below market — hold and monitor')
  }

  const status = score >= 2 ? 'attention' : 'healthy'
  const primaryArea = cm.seller_vs_median_pct > 3 ? 'pricing' : demand.trend === 'decreasing' ? 'demand' : 'none'
  const candidatePrice =
    primaryArea === 'pricing' ? cm.competitor_median_price : null

  return {
    status,
    primary_area: primaryArea,
    suggested_action: primaryArea === 'pricing' ? 'test_price' : 'monitor',
    candidate_price: candidatePrice,
    confidence: score >= 3 ? 'medium' : 'low',
    reasons,
  }
}

/**
 * POST /api/ai/chat — multi-agent grounded analysis.
 * Backend routes the question through the Supervisor (Bedrock mock by default;
 * ProductionBedrockClient is opt-in via MOCK_BEDROCK=false). All numbers come
 * from deterministic analysis results, never the LLM. Local mode returns a
 * deterministic synthesis built from real computed metrics (no LLM).
 */
export async function askAnalyst(productId, question) {
  if (USE_HTTP)
    return httpPost('/ai/chat', { product_id: productId, question })
  await localDelay(600)
  const analysis = await fetchAnalysis(productId)
  const product = await fetchProduct(productId)
  const { competitor_metrics: cm, demand, forecast_summary: fs } = analysis

  const reasons = []
  if (cm.seller_vs_median_pct > 3)
    reasons.push(`your price (₹${cm.seller_price}) is ${cm.seller_vs_median_pct}% above the competitor median (₹${cm.competitor_median_price})`)
  else if (cm.seller_vs_median_pct < -3)
    reasons.push(`your price (₹${cm.seller_price}) is ${Math.abs(cm.seller_vs_median_pct)}% below the competitor median — possible margin upside`)
  if (demand.trend === 'decreasing')
    reasons.push(`demand has been declining (${demand.change_pct}% recently)`)
  if (demand.trend === 'increasing')
    reasons.push(`demand is rising (${demand.change_pct}% recently)`)
  if (fs.delta_vs_recent_pct != null)
    reasons.push(`the 14-day forecast ${fs.delta_vs_recent_pct >= 0 ? 'indicates' : 'suggests'} about ${Math.abs(fs.delta_vs_recent_pct)}% ${fs.delta_vs_recent_pct >= 0 ? 'higher' : 'lower'} daily demand vs the last two weeks`)

  const answer = [
    `Based on the data for ${product.title}:`,
    reasons.length ? reasons.map((r) => `• ${r}`).join('\n') : '• no significant pricing or demand signals found in the current data',
    `The data suggests ${
      cm.seller_vs_median_pct > 3 && demand.trend !== 'increasing'
        ? 'investigating a price adjustment toward the competitor median'
        : 'holding the current price while monitoring the forecast'
    }.`,
  ].join('\n\n')

  return {
    agents_used: ['market_analyst', 'competitor_analyst', 'pricing_analyst'],
    answer,
    grounded_on: analysis,
  }
}


