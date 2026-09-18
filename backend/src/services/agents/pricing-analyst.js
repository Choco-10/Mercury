/**
 * Pricing Analyst Agent
 * Interprets pricing scenarios from analysis.pricing_scenarios
 * Uses forecast outputs to compare trade-offs
 * Does NOT calculate numbers — reads from scenario results
 */

import { createBedrockClient } from '../bedrock-client.js';

export class PricingAnalyst {
  constructor(bedrockClient = null) {
    this.bedrock = bedrockClient || createBedrockClient({ mock: true });
  }

  /**
   * Analyze pricing scenarios for a product
   */
  async analyze(productId, context) {
    const { analysis, product, pricing_scenarios } = context;
    
    const agentInput = {
      agent: 'pricing_analyst',
      product_id: productId,
      question: 'Analyze the pricing scenarios and trade-offs for this product',
      context: {
        product,
        analysis,
        pricing_scenarios,
      },
    };

    const bedrockResponse = await this.bedrock.converse(agentInput);
    
    // Parse the response
    let result;
    if (bedrockResponse.output?.message?.content?.[0]?.text) {
      result = JSON.parse(bedrockResponse.output.message.content[0].text);
    } else if (bedrockResponse.findings) {
      result = bedrockResponse;
    } else {
      result = { findings: [], summary: '', confidence: 'low', data_sources: [] };
    }
    
    return {
      agent: 'pricing_analyst',
      product_id: productId,
      findings: result.findings || [],
      summary: result.summary || '',
      confidence: result.confidence || 'medium',
      data_sources: result.data_sources || [],
      missing_data: result.missing_data,
    };
  }
}

export function createPricingAnalyst(config = {}) {
  return new PricingAnalyst(config.bedrockClient);
}
