/**
 * Supervisor Agent
 * Routes questions to specialists and synthesizes responses
 */

import { createBedrockClient } from '../bedrock-client.js';
import { createMarketAnalyst } from './market-analyst.js';
import { createCompetitorAnalyst } from './competitor-analyst.js';
import { createPricingAnalyst } from './pricing-analyst.js';

export class SupervisorAgent {
  constructor(config = {}) {
    this.bedrock = config.bedrockClient || createBedrockClient({ mock: true });
    this.marketAnalyst = config.marketAnalyst || createMarketAnalyst({ bedrockClient: this.bedrock });
    this.competitorAnalyst = config.competitorAnalyst || createCompetitorAnalyst({ bedrockClient: this.bedrock });
    this.pricingAnalyst = config.pricingAnalyst || createPricingAnalyst({ bedrockClient: this.bedrock });
  }

  async process(question, context) {
    const { product_id, product, analysis, competitors, pricing_scenarios } = context;
    
    if (!product_id) throw new Error('product_id is required');
    
    const specialists = this.determineSpecialists(question, context);
    const results = await this.callSpecialists(specialists, product_id, context);
    return this.synthesize(question, results, context);
  }

  determineSpecialists(question, context) {
    const q = question.toLowerCase();
    const specialists = ['market_analyst']; // Always include market analyst
    
    if (q.includes('competitive') || q.includes('competitor') || q.includes('price') || 
        q.includes('pricing') || q.includes('position')) {
      specialists.push('competitor_analyst');
    }
    
    if (q.includes('what') && (q.includes('happen') || q.includes('if') || 
        q.includes('change') || q.includes('reduce') || q.includes('increase'))) {
      specialists.push('pricing_analyst');
    }
    
    return [...new Set(specialists)];
  }
  
  async callSpecialists(specialistNames, productId, context) {
    const calls = specialistNames.map(async (name) => {
      try {
        switch (name) {
          case 'market_analyst':
            return await this.marketAnalyst.analyze(productId, context);
          case 'competitor_analyst':
            return await this.competitorAnalyst.analyze(productId, context);
          case 'pricing_analyst':
            return await this.pricingAnalyst.analyze(productId, context);
          default:
            return null;
        }
      } catch (err) {
        console.error(`Specialist ${name} failed:`, err);
        return { agent: name, product_id: productId, findings: [], summary: `Analysis unavailable: ${err.message}`, confidence: 'low', data_sources: [], error: err.message };
      }
    });
    
    const results = await Promise.all(calls);
    return results.filter(r => r !== null);
  }
  
  async synthesize(question, specialistResults, context) {
    const { product_id, product, analysis } = context;
    
    const agentInput = {
      agent: 'supervisor',
      product_id: product_id,
      question,
      context: { product, analysis, pricing_scenarios: context.pricing_scenarios, specialist_results: specialistResults },
    };

    const bedrockResponse = await this.bedrock.converse(agentInput);
    
    // Parse the response
    let result;
    if (bedrockResponse.output?.message?.content?.[0]?.text) {
      result = JSON.parse(bedrockResponse.output.message.content[0].text);
    } else if (bedrockResponse.response) {
      // Already parsed
      result = bedrockResponse;
    } else {
      result = { summary: '', findings: [], data_sources: [], confidence: 'medium' };
    }
    
    const allFindings = specialistResults.flatMap(r => r.findings || []);
    const allDataSources = [...new Set(specialistResults.flatMap(r => r.data_sources || []))];
    const allMissingData = specialistResults.flatMap(r => r.missing_data || []);
    const confidences = specialistResults.map(r => r.confidence);
    const overallConfidence = confidences.some(c => c === 'low') ? 'low' : confidences.some(c => c === 'medium') ? 'medium' : 'high';
    
    return {
      response: result.summary || this.buildFallbackResponse(specialistResults, question),
      analysis_stages: specialistResults.map(r => ({ stage: r.agent, status: r.error ? 'failed' : 'completed', finding: r.summary || '' })),
      data_sources: allDataSources,
      confidence: overallConfidence,
      missing_data: allMissingData.length > 0 ? allMissingData : undefined,
      agents_used: specialistResults.map(r => r.agent),
    };
  }
  
  buildFallbackResponse(specialistResults, question) {
    const parts = specialistResults.filter(r => r.summary && !r.error).map(r => r.summary);
    if (parts.length === 0) return "I don't have enough data to answer that question. Please ensure sales history and competitor data are uploaded.";
    return parts.join(' ');
  }
}

export function createSupervisorAgent(config = {}) {
  return new SupervisorAgent(config);
}

