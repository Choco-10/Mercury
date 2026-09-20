/**
 * Competitor Analyst Agent
 * Analyzes competitor positioning from analysis.competitor_metrics
 * Does NOT calculate numbers — reads from competitor_metrics
 */

import { createBedrockClient } from '../bedrock-client.js';

export class CompetitorAnalyst {
  constructor(bedrockClient = null) {
    this.bedrock = bedrockClient || createBedrockClient();
  }

  /**
   * Analyze competitor data for a product
   */
  async analyze(productId, context) {
    const { analysis, product, competitors } = context;
    
    const agentInput = {
      agent: 'competitor_analyst',
      product_id: productId,
      question: 'Analyze the competitor positioning and pricing for this product',
      context: {
        product,
        analysis,
        competitors,
      },
    };

    const bedrockResponse = await this.bedrock.converse(agentInput);
    
    // Parse the response - the runtime client returns the parsed result directly
    // (older mock doubles wrapped it as output.message.content[0].text JSON).
    let result;
    if (bedrockResponse.output?.message?.content?.[0]?.text) {
      result = JSON.parse(bedrockResponse.output.message.content[0].text);
    } else if (bedrockResponse.findings) {
      // Direct result format
      result = bedrockResponse;
    } else {
      result = { findings: [], summary: '', confidence: 'low', data_sources: [] };
    }
    
    return {
      agent: 'competitor_analyst',
      product_id: productId,
      findings: result.findings || [],
      summary: result.summary || '',
      confidence: result.confidence || 'medium',
      data_sources: result.data_sources || [],
      missing_data: result.missing_data,
    };
  }
}

export function createCompetitorAnalyst(config = {}) {
  return new CompetitorAnalyst(config.bedrockClient);
}
