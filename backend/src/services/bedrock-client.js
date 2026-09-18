/**
 * Bedrock Runtime wrapper with mock support.
 * The Bedrock SDK is imported lazily inside ProductionBedrockClient so the
 * mock path (the default) never requires or calls AWS. No AWS credits are
 * used unless MOCK_BEDROCK=false is explicitly configured with credentials.
 */

export class MockBedrockClient {
  constructor() {
    this.requestLog = [];
  }

  async converse(params) {
    this.requestLog.push(params);
    
    // Support both direct agentInput and full params format
    let agentInput;
    if (params.messages) {
      // Full params format from ProductionBedrockClient
      const userMessage = params.messages.find(m => m.role === 'user');
      if (!userMessage) throw new Error('No user message');
      try {
        agentInput = JSON.parse(userMessage.content[0].text);
      } catch {
        agentInput = { agent: 'supervisor', product_id: 'unknown', question: userMessage.content[0].text, context: {} };
      }
    } else if (params.agent) {
      // Direct agentInput format from specialists
      agentInput = params;
    } else {
      throw new Error('Invalid converse params: must have messages or agent field');
    }
    
    const response = this.generateMockResponse(agentInput);
    return { output: { message: { role: 'assistant', content: [{ text: JSON.stringify(response) }] } } };
  }

  generateMockResponse(input) {
    const { agent, product_id, question, context } = input;
    const findings = [];
    const dataSources = [];
    let summary = '';
    let confidence = 'medium';
    const missingData = [];

    const addFinding = (metric, value, interpretation, source) => {
      findings.push({ metric, value, interpretation });
      dataSources.push(source);
    };

    const getVal = (path, defaultValue = null) => {
      const parts = path.split('.');
      let current = context;
      for (const part of parts) {
        if (current == null) return defaultValue;
        current = current[part];
      }
      return current !== undefined ? current : defaultValue;
    };

    // Log competitor_metrics if available for debugging
    if (context.analysis?.competitor_metrics) {
      // Debug only - can be removed in production
    }
    
    switch (agent) {
      case 'market_analyst': {
        const trend = getVal('analysis.demand.trend', 'insufficient_data');
        const changePct = getVal('analysis.demand.change_pct');
        const expectedMeanDaily = getVal('analysis.forecast_summary.expected_mean_daily');
        if (trend === 'insufficient_data') {
          missingData.push('analysis.demand');
          summary = "I don't have sufficient demand trend data.";
          confidence = 'low';
          break;
        }
        addFinding('demand.trend', trend, `Trend: ${trend}`, 'analysis.demand.trend');
        if (changePct != null) addFinding('demand.change_pct', changePct, `Changed ${changePct}%`, 'analysis.demand.change_pct');
        if (expectedMeanDaily != null) addFinding('forecast.expected_mean_daily', expectedMeanDaily, `Forecast: ${expectedMeanDaily}/day`, 'analysis.forecast_summary.expected_mean_daily');
        summary = trend === 'increasing' ? `Demand increasing ${changePct != null ? changePct : 'N/A'}%.` : trend === 'decreasing' ? `Demand decreasing ${changePct != null ? changePct : 'N/A'}%.` : `Demand stable. Forecast: ${expectedMeanDaily != null ? expectedMeanDaily : 'N/A'}/day.`;
        confidence = 'high';
        break;
      }
      case 'competitor_analyst': {
        const sellerPrice = getVal('analysis.competitor_metrics.seller_price');
        const competitorMedian = getVal('analysis.competitor_metrics.competitor_median_price');
        if (sellerPrice == null || competitorMedian == null) {
          missingData.push('analysis.competitor_metrics');
          summary = "I don't have competitor data.";
          confidence = 'low';
          break;
        }
        addFinding('seller_price', sellerPrice, "Seller price", 'analysis.competitor_metrics.seller_price');
        addFinding('competitor_median_price', competitorMedian, "Median price", 'analysis.competitor_metrics.competitor_median_price');
        summary = `Your ₹${sellerPrice} is ${sellerPrice > competitorMedian ? 'above' : 'below'} median ₹${competitorMedian}.`;
        confidence = 'high';
        break;
      }
      case 'pricing_analyst': {
        const baselinePrice = getVal('pricing_scenarios.baseline_price') || getVal('analysis.competitor_metrics.seller_price');
        if (baselinePrice == null) { missingData.push('pricing_scenarios'); summary = "No pricing data."; confidence = 'low'; break; }
        addFinding('baseline_price', baselinePrice, "Current price", 'pricing_scenarios.baseline_price');
        summary = `Baseline: ₹${baselinePrice}. Run simulation to compare prices.`;
        confidence = 'medium';
        break;
      }
      case 'supervisor': {
        const cm = context.analysis?.competitor_metrics;
        const demand = context.analysis?.demand;
        if (cm?.seller_vs_median_pct != null) {
          addFinding('competitor_metrics.available', true, 'Available', 'analysis.competitor_metrics');
          summary = `Your ₹${cm.seller_price} is ${Math.abs(cm.seller_vs_median_pct)}% ${cm.seller_vs_median_pct > 0 ? 'above' : 'below'} median ₹${cm.competitor_median_price}.`;
        } else if (demand?.trend != null) {
          summary = `Demand trend: ${demand.trend}.`;
        } else {
          summary = "Insufficient data.";
          missingData.push('analysis');
          confidence = 'low';
        }
        confidence = 'medium';
        break;
      }
      default: summary = 'Unknown agent.'; confidence = 'low';
    }
    return { agent, product_id, findings, summary, confidence, data_sources: dataSources, missing_data: missingData.length ? missingData : undefined };
  }
}

// Production Bedrock client (optional). Loads the SDK on first real use.
export class ProductionBedrockClient {
  constructor(config = {}) {
    this.config = config;
    this.modelId = config.modelId || process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
    this.systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.client = null;
  }

  async converse(input) {
    if (!this.client) {
      // Requires @aws-sdk/client-bedrock-runtime at runtime; mock mode never reaches here.
      const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
      this.ConverseCommand = ConverseCommand;
      this.client = new BedrockRuntimeClient({ region: this.config.region || process.env.AWS_REGION || 'us-east-1' });
    }
    const { agent, product_id, question, context } = input;
    const userContent = JSON.stringify({ agent, product_id, question, context });

    const command = new this.ConverseCommand({
      modelId: this.modelId,
      messages: [{ role: 'user', content: [{ text: userContent }] }],
      system: [{ text: this.systemPrompt }],
      inferenceConfig: { maxTokens: 4000, temperature: 0.1 },
    });

    const response = await this.client.send(command);
    const text = response.output?.message?.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Bedrock');
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse Bedrock response:', e);
      return { agent, product_id, findings: [], summary: text, confidence: 'low', data_sources: [] };
    }
  }
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI Analyst Agent for Amazon Seller Intelligence. Interpret product data and explain to sellers.

CRITICAL RULES:
1. ONLY interpret data provided in context. Do NOT calculate anything.
2. When mentioning a number, it MUST come from context fields.
3. Cite specific field names when referencing values.
4. If context lacks needed data, say so clearly.
5. Do NOT claim causation unless data clearly supports it.
6. Return valid JSON with findings, summary, confidence, data_sources.
Do NOT invent numbers. Cite data_sources for every value used.`;

// Factory function to create appropriate Bedrock client. Mock is the default;
// the production client only activates when MOCK_BEDROCK=false is configured.
export function createBedrockClient(config = {}) {
  if (config.mock || config.testMode || process.env.MOCK_BEDROCK !== 'false') {
    return new MockBedrockClient();
  }
  return new ProductionBedrockClient(config);
}


