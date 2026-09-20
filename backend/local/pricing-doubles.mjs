/** Local doubles for offline development ONLY (backend/local/*).
 * Never imported by the Lambda bundle: production always injects the real
 * SageMaker runtime + Bedrock runtime clients via backend/src/services/pricing/aws-clients.js
 * and backend/src/services/bedrock-client.js. */

/** Deterministic endpoint stand-in: recent demand attenuates as price rises. */
export function createLocalEndpointInvoker({ elasticity = -1.2 } = {}) {
  return async function invokeLocalEndpoint(payload, { baseFeatures, currentPrice } = {}) {
    if (typeof payload === 'string') {
      const parts = payload.split(',').map(Number)
      const price = parts[2]
      const avg7 = parts[5]
      if ([price, avg7].every(Number.isFinite) && avg7 > 0) {
        const anchor = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : price
        const units = avg7 * Math.pow(price / anchor, elasticity)
        return Math.max(0, Math.round(units * 1000) / 1000)
      }
      return 0
    }
    const price = Number(baseFeatures?.price ?? currentPrice)
    const avg7 = Number(baseFeatures?.sales_7d_avg)
    if (!(price > 0) || !(avg7 > 0)) return 0
    const anchor = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : price
    return Math.max(0, Math.round(avg7 * Math.pow(price / anchor, elasticity) * 1000) / 1000)
  }
}

/** Dev Bedrock double: picks the objective-optimal scenario without an LLM. */
export function createLocalBedrockClient() {
  return {
    async converseJson({ user } = {}) {
      let input = {}
      try { input = JSON.parse(user) } catch { input = {} }
      const scenarios = Array.isArray(input.scenarios) ? input.scenarios : []
      const objective = input.objective === 'increase_sales' ? 'increase_sales' : 'maximize_revenue'
      const metric = objective === 'increase_sales' ? 'predicted_units' : 'predicted_revenue'
      const best = [...scenarios].sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0))[0] ?? null
      const summaryParts = [
        `Offline recommendation for ${input.product_id ?? 'the product'}`,
        best ? `price ${best.price} (${metric} ${best[metric]})` : 'no scenarios supplied',
      ]
      if (input.correction) summaryParts.push('re-asked after an out-of-range pick')
      return {
        recommended_price: best?.price ?? null,
        predicted_units: best?.predicted_units ?? null,
        predicted_revenue: best?.predicted_revenue ?? null,
        summary: `${summaryParts.join('; ')}.`,
        reasoning: `${summaryParts.join('; ')}.`,
        findings: [],
        confidence: 'low',
        missing_data: ['offline mode: deterministic stand-in, not Bedrock'],
      }
    },
  }
}
