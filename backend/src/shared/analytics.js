/**
 * Shared deterministic analytics used by both the frontend demo mode
 * and the backend Lambda services. NO LLM involvement in this module.
 */

/**
 * Deterministic PRNG (mulberry32) so demo data is stable across reloads.
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Linear trend slope of series over its index (units per day).
 */
export function linearTrendSlope(values) {
  const n = values.length
  if (n < 2) return 0
  const sumX = (n * (n - 1)) / 2
  const sumY = values.reduce((s, v) => s + v, 0)
  const sumXY = values.reduce((s, v, i) => s + i * v, 0)
  const sumX2 = (n - 1) * n * (2 * n - 1) / 6
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return 0
  return (n * sumXY - sumX * sumY) / denom
}

/**
 * Weekday seasonal factors, normalized to mean 1.
 * Returns array of 7 factors indexed by Date.getDay() (0=Sunday).
 */
export function weekdayFactors(dates, values) {
  const sums = Array(7).fill(0)
  const counts = Array(7).fill(0)
  dates.forEach((d, i) => {
    const day = new Date(d).getDay()
    sums[day] += values[i]
    counts[day] += 1
  })
  const factors = sums.map((s, i) => (counts[i] ? s / counts[i] : 1))
  const mean = factors.reduce((a, b) => a + b, 0) / 7
  return factors.map((f) => (mean > 0 ? f / mean : 1))
}

/**
 * Basic statistics helpers.
 */
export function mean(values) {
  if (!values.length) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

export function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function stdDev(values) {
  if (values.length < 2) return 0
  const m = mean(values)
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/**
 * Forecast via linear trend + weekday seasonality, with a normal-approx
 * 80% uncertainty interval derived from residual std dev.
 */
export function forecastSeries(dates, values, horizon = 14) {
  const n = values.length
  if (n < 3) return []
  const slope = linearTrendSlope(values)
  const intercept = mean(values) - slope * ((n - 1) / 2)
  const factors = weekdayFactors(dates, values)
  const residuals = values.map((v, i) => v - (intercept + slope * i))
  const sigma = stdDev(residuals) || Math.max(1, mean(values) * 0.2)
  const z = 1.28 // ~80% two-sided interval
  const lastDate = new Date(dates[n - 1])
  const out = []
  for (let h = 1; h <= horizon; h++) {
    const date = new Date(lastDate)
    date.setDate(lastDate.getDate() + h)
    const idx = n - 1 + h
    const base = intercept + slope * idx
    const season = factors[date.getDay()] || 1
    const expected = Math.max(0, base * season)
    const spread = z * sigma
    out.push({
      date: date.toISOString().slice(0, 10),
      expected: Math.round(expected),
      lower: Math.max(0, Math.round(expected - spread)),
      upper: Math.round(expected + spread),
    })
  }
  return out
}

/**
 * Classify demand trend over a recent window.
 */
export function classifyTrend(values, recentWindow = 21) {
  if (values.length < recentWindow) return { direction: 'insufficient_data', changePct: 0 }
  const recent = values.slice(-recentWindow)
  const prior = values.slice(0, -recentWindow)
  const recentMean = mean(recent)
  const priorMean = mean(prior.length ? prior : recent)
  if (priorMean === 0) return { direction: 'stable', changePct: 0 }
  const changePct = ((recentMean - priorMean) / priorMean) * 100
  if (changePct > 8) return { direction: 'increasing', changePct: round1(changePct) }
  if (changePct < -8) return { direction: 'decreasing', changePct: round1(changePct) }
  return { direction: 'stable', changePct: round1(changePct)}
}

function round1(x) {
  return Math.round(x * 10) / 10
}
