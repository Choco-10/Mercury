/**
 * The pricing multi-agent system (ai.md §22) — the SAME four existing agents used by
 * /api/ai/chat, driven by the prompts in bedrock/*.txt (ai.md §28).
 *
 *   Supervisor ──┬── Market Analyst      (demand across the seven scenarios)
 *                ├── Competitor Analyst  (supplied competitor prices only)
 *                └── Pricing Analyst     (objective pick from the seven scenarios)
 *
 * Hard boundaries enforced here:
 *   - competitors are passed as context, never to XGBoost (§32)
 *   - every number the agents may mention is supplied by the caller; nothing is computed
 *   - the Pricing Analyst may only select from the seven supplied prices (§22)
 */
import { CONTRACT, PricingError } from './contract.js'

export const AGENT_PROMPTS = {
  supervisor: 'supervisor_agent_prompt.txt',
  market_analyst: 'market_analyst_agent_prompt.txt',
  competitor_analyst: 'competitor_analyst_agent_prompt.txt',
  pricing_analyst: 'pricing_analyst_agent_prompt.txt',
}

function compact(value) {
  return JSON.stringify(value)
}

async function askAgent(bedrock, { prompt, input, maxTokens }) {
  try {
    return await bedrock.converseJson({ system: prompt, user: compact(input), maxTokens })
  } catch (err) {
    throw new PricingError(`Bedrock agent call failed: ${err.message}`, 'bedrock_unavailable')
  }
}
/**
 * Run the agent pipeline and return the Supervisor's recommendation plus each agent's
 * structured output (kept in the response so the seller can audit the reasoning).
 */
export async function runPricingAgents({ bedrock, prompts, productId, objective,
  currentPrice, product, historySummary, competitors, simulation, maxTokens = 1500 }) {
  if (!bedrock || typeof bedrock.converseJson !== 'function') {
    throw new PricingError('the Bedrock client is not configured', 'bedrock_unavailable')
  }
  const scenarios = simulation.scenarios.map(({ price, predicted_units, predicted_revenue,
    price_change_percent }) => ({ price, predicted_units, predicted_revenue,
    price_change_percent }))

  const [marketAnalyst, competitorAnalyst] = await Promise.all([
    askAgent(bedrock, {
      prompt: prompts.market_analyst,
      maxTokens,
      input: {
        product_id: productId,
        objective,
        current_price: currentPrice,
        seller_history: historySummary,
        scenarios,
      },
    }),
    askAgent(bedrock, {
      prompt: prompts.competitor_analyst,
      maxTokens,
      input: {
        product_id: productId,
        current_price: currentPrice,
        competitors: competitors.map(({ competitor_id, competitor_product_id,
          competitor_price, competitor_discount }) => ({ competitor_id,
          competitor_product_id, competitor_price, competitor_discount })),
        scenarios: scenarios.map(({ price }) => ({ price })),
      },
    }),
  ])

  const pricingAnalyst = await askAgent(bedrock, {
    prompt: prompts.pricing_analyst,
    maxTokens,
    input: {
      product_id: productId,
      objective,
      current_price: currentPrice,
      scenarios,
      market_analyst: { summary: marketAnalyst.summary, findings: marketAnalyst.findings },
      competitor_analyst: {
        summary: competitorAnalyst.summary,
        findings: competitorAnalyst.findings,
        competitor_median_price: competitorAnalyst.competitor_median_price ?? null,
      },
    },
  })

  const supervisor = await askAgent(bedrock, {
    prompt: prompts.supervisor,
    maxTokens,
    input: {
      product_id: productId,
      objective,
      current_price: currentPrice,
      product: product ?? null,
      seller_history_summary: historySummary,
      competitors: competitors.map(({ competitor_id, competitor_product_id,
        competitor_price, competitor_discount }) => ({ competitor_id,
        competitor_product_id, competitor_price, competitor_discount })),
      scenarios,
      candidate_prices: scenarios.map((scenario) => scenario.price),
      objective_rule: objective === 'increase_sales'
        ? 'highest predicted_units' : 'highest predicted_revenue',
      specialist_analysis: {
        market_analyst: { summary: marketAnalyst.summary,
          confidence: marketAnalyst.confidence ?? null },
        competitor_analyst: { summary: competitorAnalyst.summary,
          confidence: competitorAnalyst.confidence ?? null,
          competitor_median_price: competitorAnalyst.competitor_median_price ?? null },
        pricing_analyst: { recommended_price: pricingAnalyst.recommended_price ?? null,
          summary: pricingAnalyst.summary, trade_off: pricingAnalyst.trade_off ?? null,
          confidence: pricingAnalyst.confidence ?? null },
      },
      allowed_objectives: CONTRACT.objectives,
    },
  })

  return {
    recommendation: {
      recommended_price: supervisor.recommended_price,
      objective: supervisor.objective ?? objective,
      reasoning: supervisor.reasoning ?? supervisor.summary ?? '',
      competitor_comparison: supervisor.competitor_comparison ?? null,
      confidence: supervisor.confidence ?? null,
      missing_data: Array.isArray(supervisor.missing_data) ? supervisor.missing_data : [],
    },
    agents: {
      market_analyst: marketAnalyst,
      competitor_analyst: competitorAnalyst,
      pricing_analyst: pricingAnalyst,
      supervisor,
    },
  }
}

/**
 * Re-ask the Supervisor with an explicit list of allowed prices (ai.md §27).
 *
 * Used when the first answer contained a price outside the seven evaluated candidates.
 * Returns the still-unvalidated answer, or null when Bedrock cannot answer at all.
 */
export async function reaskSupervisor({ bedrock, prompts, objective, candidatePrices,
  previous, maxTokens = 800 }) {
  try {
    return await bedrock.converseJson({
      system: prompts.supervisor,
      maxTokens,
      user: compact({
        correction: 'Your recommended_price was NOT one of the seven evaluated candidates.',
        rejected_recommendation: previous ?? null,
        allowed_prices: candidatePrices,
        instruction: 'Answer again and choose recommended_price from allowed_prices only.',
        objective,
      }),
    })
  } catch {
    return null
  }
}
