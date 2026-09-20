/**
 * Market Analyst Agent
 * Analyzes demand trends from analysis.demand
 * Does NOT calculate numbers — reads them from analysis result
 */

import { createBedrockClient } from '../bedrock-client.js';

export class MarketAnalyst {
  constructor(bedrockClient = null) {
    this.bedrock = bedrockClient || createBedrockClient();
  }

  /**
   * Analyze market/demand data for a product
   */
  async analyze(productId, context) {
    const { analysis, product } = context;
    
    // Build the agent input for Bedrock
    const agentInput = {
      agent: 'market_analyst',
      product_id: productId,
      question: 'Analyze the demand trend and market data for this product',
      context: {
        product,
        analysis,
      },
    };

    // Call Bedrock (or mock)
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
      agent: 'market_analyst',
      product_id: productId,
      findings: result.findings || [],
      summary: result.summary || '',
      confidence: result.confidence || 'medium',
      data_sources: result.data_sources || [],
      missing_data: result.missing_data,
    };
  }
}

export function createMarketAnalyst(config = {}) {
  return new MarketAnalyst(config.bedrockClient);
}
