/**
 * Analysis service — deterministic calculations identical to frontend demo mode.
 * Reuses shared/analytics.js so numbers match across local and AWS modes.
 */
import { forecastSeries, classifyTrend, linearTrendSlope, mean } from '../shared/analytics.js'

export function competitorMetrics(product, competitors) {
  const prices = competitors.map((c) => c.price)
  const avg = mean(prices)
  const med = median(prices)
  return {
    competitor_avg_price: Math.round(avg),
    competitor_median_price: Math.round(med),
    competitor_min_price: Math.min(...prices),
    competitor_max_price: Math.max(...prices),
    seller_price: product.price,
    seller_position: product.price > Math.max(...prices) ? 'above_all' : product.price < Math.min(...prices) ? 'below_all' : 'within_range',
    seller_vs_median_pct: med ? Math.round(((product.price - med) / med) * 1000) / 10 : 0,
  }
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function simulatePricing(product, salesHistory, scenarioPrices, elasticityPct = 1.4) {
  const baseUnits = mean(salesHistory.slice(-21).map((s) => s.units_sold)) || 1
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
      competitor_position: price < basePrice * 0.97 ? 'undercutting' : price > basePrice * 1.03 ? 'premium' : 'at_par',
    }
  })
}

export function buildAnalysis(product, sales, competitors) {
  const metrics = competitorMetrics(product, competitors)
  const units = sales.map((s) => s.units_sold)
  const trend = classifyTrend(units)
  const slope = linearTrendSlope(units.slice(-30))
  const fc = forecastSeries(sales.map((s) => s.date), units, 14)
  const fcMean = fc.length ? mean(fc.map((f) => f.expected)) : null
  const recentMean = mean(units.slice(-14))
  const fcDeltaPct = fcMean && recentMean ? Math.round(((fcMean - recentMean) / recentMean) * 1000) / 10 : null

  const rec = buildRecommendation(metrics, trend, fcDeltaPct)

  return {
    product_id: product.product_id,
    generated_at: new Date().toISOString(),
    competitor_metrics: metrics,
    demand: { trend: trend.direction, change_pct: trend.changePct, slope_30d: Math.round(slope * 100) / 100 },
    forecast_summary: {
      horizon_days: 14,
      expected_mean_daily: fcMean != null ? Math.round(fcMean) : null,
      delta_vs_recent_pct: fcDeltaPct,
      total_expected_14d: fc.reduce((s, f) => s + f.expected, 0),
    },
    recommendation: rec,
  }
}

export function buildRecommendation(cm, trend, fcDeltaPct) {
  const reasons = []
  let score = 0
  if (cm.seller_vs_median_pct > 3) {
    score += 2
    reasons.push(`seller price is ${cm.seller_vs_median_pct}% above competitor median (₹${cm.competitor_median_price})`)
  } else if (cm.seller_vs_median_pct < -5) {
    score += 1
    reasons.push(`seller price is ${Math.abs(cm.seller_vs_median_pct)}% below competitor median — margin review possible`)
  }
  if (trend.direction === 'decreasing') {
    score += 2
    reasons.push(`demand declined ${Math.abs(trend.changePct)}% recently`)
  }
  if (fcDeltaPct != null && fcDeltaPct < -10) {
    score += 1
    reasons.push(`14-day forecast indicates demand easing (~${Math.abs(fcDeltaPct)}% lower)`)
  }
  if (trend.direction === 'increasing' && cm.seller_vs_median_pct <= 0) {
    reasons.push('demand is rising while price is at/below market — hold and monitor')
  }
  const status = score >= 2 ? 'attention' : 'healthy'
  const primaryArea = cm.seller_vs_median_pct > 3 ? 'pricing' : trend.direction === 'decreasing' ? 'demand' : 'none'
  return {
    status,
    primary_area: primaryArea,
    suggested_action: primaryArea === 'pricing' ? 'test_price' : 'monitor',
    candidate_price: primaryArea === 'pricing' ? cm.competitor_median_price : null,
    confidence: score >= 3 ? 'medium' : 'low',
    reasons,
  }
}
