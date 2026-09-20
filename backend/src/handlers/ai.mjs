/**
 * AI Chat Handler - Multi-agent grounded analysis endpoint
 * POST /api/ai/chat
 */

import { SupervisorAgent } from '../services/agents/supervisor.js';
import { createBedrockClient } from '../services/bedrock-client.js';
import { computeAnalysis, AnalysisDataError } from '../services/analysis-run.js';

// The storage adapter is injected by the API router (DynamoDB in production,
// in-memory store for the offline local server). No direct adapter import here.

// Agent-specific prompts for structured output
const SUPERVISOR_SYSTEM_PROMPT = `You are the Supervisor Agent for Amazon Seller Intelligence.
Your job is to understand the seller's question, determine which analyses are needed,
and synthesize findings from specialist agents into a clear, grounded response.

CRITICAL RULES:
1. You ONLY interpret data provided in the context. Do NOT calculate anything.
2. All numbers MUST come from the context fields - never invent numbers.
3. Cite specific field names when referencing values.
4. If context lacks data you need, say so clearly.
5. Return your response as plain text (not JSON) - a clear, seller-friendly answer.
6. Do NOT claim causation unless the data clearly supports it.

Available context includes:
- product: product details (id, title, category, price, rating, etc.)
- analysis: full analysis with competitor_metrics, demand, forecast_summary
- competitors: array of competitor objects
- pricing_scenarios: pricing simulation results (if available)
- specialist_results: findings from market_analyst, competitor_analyst, pricing_analyst

Example response (GROUNDED) — every <placeholder> is filled from the actual context, never invented:
"Your product <product_id> (<title>) is priced at ₹<price>, which is <difference_percent>% above the competitor median of ₹<median_price>. Your 14-day forecast shows expected demand of <expected_daily_demand> units/day, down <change_percent>% from the recent average. Among <competitor_count> competitors, <priced_below_you> are priced below you."

Example response (UNGROUNDED - WRONG):
"You should lower your price because competitors are undercutting you." // No numbers, no sources
`;

export async function handleAIChat(event, store, bedrockClient = null) {
  if (!store || typeof store.getProduct !== 'function') {
    throw new Error('AI chat requires a storage adapter')
  }
  const { getProduct, getSales, getCompetitorsLatest, getAnalysis } = store
  // Parse request body
  const body = await parseBody(event);
  
  if (!body || typeof body !== 'object') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Request body must be a JSON object' }) };
  }
  
  const { product_id } = body;

  // Frontend contract (frontend/src/services/api.js askAnalyst) sends `question`;
  // `message` remains accepted for backward compatibility with earlier callers.
  const question = typeof body.question === 'string' && body.question.trim()
    ? body.question
    : (typeof body.message === 'string' ? body.message : undefined);

  // Validate required fields
  if (!product_id || typeof product_id !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'product_id is required' }) };
  }

  if (!question || !question.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'question is required' }) };
  }

  try {
    // Always the real Bedrock runtime client unless a caller injects a client
    // explicitly (tests / the offline dev double). There is no mock default.
    const bedrock = bedrockClient || createBedrockClient();
    
    // Create supervisor agent
    const supervisor = new SupervisorAgent({ bedrockClient: bedrock });

    // Fetch actual data from storage
    const [product, sales, competitors, storedAnalysis] = await Promise.all([
      getProduct(product_id),
      getSales(product_id),
      getCompetitorsLatest(product_id),
      getAnalysis(product_id),
    ]);

    if (!product) {
      return { statusCode: 404, body: JSON.stringify({ error: `Product ${product_id} not found` }) };
    }

    // Grounded context: reuse the same-day deterministic snapshot when present,
    // otherwise compute it on demand (identical guarded calculation as the
    // analysis endpoints) and store it so the same-day report is reused.
    const missing_data = [];
    let analysis = storedAnalysis || null;
    if (!analysis) {
      try {
        analysis = await computeAnalysis(product, sales, competitors);
        await store.putAnalysis(analysis);
      } catch (err) {
        if (!(err instanceof AnalysisDataError)) throw err;
        // Missing/insufficient source data is a valid AI state, not a crash.
        missing_data.push(...err.issues);
      }
    }

    // Build context with REAL data — agents only interpret, never calculate
    const agentContext = {
      product_id,
      product,
      analysis,
      competitors: competitors || [],
    };

    // Filter out null values for cleaner context
    Object.keys(agentContext).forEach(key => {
      if (agentContext[key] === null || agentContext[key] === undefined) {
        delete agentContext[key];
      }
    });

    // Process through supervisor
    const result = await supervisor.process(question, agentContext);
    const mergedMissing = [...missing_data, ...(result.missing_data || [])];

    // Return structured response
    return {
      statusCode: 200,
      body: JSON.stringify({
        // Same grounded text under both keys: `response` per the API contract,
        // `answer` for the existing frontend consumer.
        response: result.response,
        answer: result.response,
        analysis_stages: result.analysis_stages,
        data_sources: result.data_sources,
        confidence: result.confidence,
        missing_data: mergedMissing.length > 0 ? mergedMissing : undefined,
        agents_used: result.agents_used,
        suggested_follow_up: generateFollowUpSuggestions(question, result.data_sources),
      }),
    };
  } catch (err) {
    console.error('AI chat handler error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Analysis failed',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      }),
    };
  }
}

/**
 * Parse the request body from API Gateway event
 */
async function parseBody(event) {
  if (!event.body) return {};
  
  try {
    const text = event.isBase64Encoded 
      ? Buffer.from(event.body, 'base64').toString('utf8') 
      : event.body;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Generate suggested follow-up questions based on context
 */
function generateFollowUpSuggestions(question, dataSources) {
  const suggestions = [];
  const hasPriceData = dataSources.includes('analysis.competitor_metrics.seller_price');
  const hasDemandData = dataSources.includes('analysis.demand.trend');
  const hasForecastData = dataSources.includes('analysis.forecast_summary.expected_mean_daily');
  
  if (hasPriceData && hasDemandData) {
    suggestions.push('What price should I test?');
    suggestions.push('Show me the competitor details.');
  }
  
  if (hasForecastData) {
    suggestions.push('Explain the 14-day forecast in more detail.');
  }
  
  if (!suggestions.length) {
    suggestions.push('Upload sales and competitor data for analysis.');
  }
  
  // Add generic suggestions
  suggestions.push('What are my main competitive risks?');
  
  return suggestions.slice(0, 3); // Max 3 suggestions
}

export { SUPERVISOR_SYSTEM_PROMPT };
