/**
 * Candidate prices, SageMaker invocations and revenue (ai.md §13/§17/§18/§19).
 *
 *   - exactly SEVEN candidates: P-10%, -7.5%, -5%, -2.5%, P, +2.5%, +5%, rounded to the
 *     nearest whole currency unit. When whole-unit rounding collapses candidates into
 *     duplicates (M5-scale prices are single digits, e.g. every candidate of 1.96 rounds
 *     to 2), the set is rounded to two decimals so seven DISTINCT candidates survive —
 *     ai.md §17 requires "always exactly seven candidate prices"
 *   - ONE InvokeEndpoint call per candidate, sequentially (the serverless endpoint runs
 *     at MaxConcurrency 1), ContentType text/csv, one row of nine numeric values
 *   - predicted_revenue = candidate_price x predicted_units is computed here, in
 *     application code (ai.md §19) — never by XGBoost, never by Bedrock
 *   - only `price` and `price_change_percent` differ between candidate rows (ai.md §18)
 *
 * Mirrors inference/price_simulator.py, including the objective-optimal pick used to
 * validate (and, if necessary, deterministically replace) the Bedrock recommendation.
 */
import { CANDIDATE_DELTAS_PERCENT, CONTRACT, PricingError } from './contract.js'
import { candidateFeatures, endpointPayload } from './feature-engineering.js'

export function candidatePrices(currentPrice, contract = CONTRACT) {
  const deltas = CANDIDATE_DELTAS_PERCENT
  if (!(Number.isFinite(currentPrice) && currentPrice > 0)) {
    throw new PricingError('the seller price must be finite and positive', 'invalid_history')
  }
  const build = (decimals) => {
    const prices = []
    for (const delta of deltas) {
      const price = Number((currentPrice * (1 + delta / 100)).toFixed(decimals))
      if (!prices.includes(price)) prices.push(price)
    }
    return prices
  }
  let prices = build(contract.candidate_price_rounding.decimals)
  if (prices.length < deltas.length) {
    prices = build(contract.candidate_price_rounding.fallback_decimals)
  }
  if (prices.length !== deltas.length) {
    throw new PricingError(
      `could not build ${deltas.length} distinct candidate prices for ${currentPrice}`,
      'invalid_history')
  }
  return prices
}

/** Deterministic objective pick (ai.md §21) — the validation / fallback reference. */
export function objectiveOptimal(scenarios, objective) {
  if (!CONTRACT.objectives.includes(objective)) {
    throw new PricingError(`objective must be one of ${CONTRACT.objectives.join(' | ')}`,
      'invalid_input')
  }
  const metric = objective === 'increase_sales' ? 'predicted_units' : 'predicted_revenue'
  return scenarios.reduce((best, scenario) => {
    if (!best) return scenario
    if (scenario[metric] !== best[metric]) return scenario[metric] > best[metric] ? scenario : best
    // Ties keep the candidate closest to the current price.
    return Math.abs(scenario.price_change_percent) < Math.abs(best.price_change_percent)
      ? scenario : best
  }, null)
}

/**
 * Predict every candidate with the SageMaker endpoint (ai.md §18) and price it (§19).
 * `invoke` performs the single network call per candidate and returns predicted units.
 */
export async function simulateCandidates({ baseFeatures, currentPrice, invoke,
  endpointName, contract = CONTRACT }) {
  if (typeof invoke !== 'function') {
    throw new PricingError('the SageMaker endpoint is not configured', 'aws_not_configured')
  }
  const prices = candidatePrices(currentPrice, contract)
  const scenarios = []
  for (const price of prices) {
    const features = candidateFeatures(baseFeatures, price, currentPrice)
    const payload = endpointPayload(features, contract)
    let predictedUnits
    try {
      predictedUnits = Number(await invoke(payload))
    } catch (err) {
      throw new PricingError(
        `SageMaker endpoint ${endpointName} invocation failed: ${err.message}`,
        'endpoint_unavailable')
    }
    if (!Number.isFinite(predictedUnits)) {
      throw new PricingError(
        `SageMaker endpoint ${endpointName} returned a non-numeric prediction`,
        'endpoint_invalid_response')
    }
    scenarios.push({
      price,
      predicted_units: predictedUnits,
      predicted_revenue: Number((price * predictedUnits).toFixed(6)), // §19, app code
      price_change_percent: Math.round(features.price_change_percent * 10000) / 10000,
    })
  }
  return { endpoint: endpointName, candidates_evaluated: prices.length, invocations: prices.length, scenarios }
}

/** `undercutting` / `at_par` / `premium` — same ±3% rule the simulator always used. */
export function competitorPosition(price, currentPrice) {
  if (price < currentPrice * 0.97) return 'undercutting'
  if (price > currentPrice * 1.03) return 'premium'
  return 'at_par'
}
