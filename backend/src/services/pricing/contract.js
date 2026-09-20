/**
 * The canonical pricing contract, shared with the Python reference implementation
 * (inference/feature_engineering.py + inference/price_simulator.py). The canonical
 * source is shared/pricing-contract.json; backend/scripts/sync-shared.mjs copies it
 * into this bundle before sam build (the Lambda cannot read outside backend/src).
 *
 * Why one file for both languages: the seven candidate prices, the nine features and
 * the objective names are correctness-critical (ai.md §6/§17/§21) and must not drift
 * between the API that serves the recommendation and the tooling that verifies it.
 */
import { readFileSync } from 'node:fs'

export const CONTRACT = JSON.parse(
  readFileSync(new URL('../../shared/pricing-contract.json', import.meta.url), 'utf8'))

export const FEATURES = CONTRACT.features
export const TARGET = CONTRACT.target
export const OBJECTIVES = CONTRACT.objectives
export const CANDIDATE_DELTAS_PERCENT = CONTRACT.candidate_price_deltas_percent
export const MIN_HISTORY_DAYS = CONTRACT.min_history_days

/** Public error code → HTTP status for every pricing failure. */
export const PRICING_STATUS = {
  invalid_input: 400,
  unsupported_product: 422,
  missing_mapping: 500,
  no_seller_history: 422,
  invalid_history: 422,
  insufficient_history: 422,
  endpoint_unavailable: 502,
  endpoint_invalid_response: 502,
  bedrock_unavailable: 502,
  aws_not_configured: 503,
}

export class PricingError extends Error {
  constructor(message, code = 'invalid_input', details = undefined) {
    super(message)
    this.name = 'PricingError'
    this.code = code
    this.statusCode = PRICING_STATUS[code] ?? 500
    this.details = details
  }
}
