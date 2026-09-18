/**
 * Tests for Bedrock multi-agent system
 */
import { MockBedrockClient } from '../src/services/bedrock-client.js';
import { SupervisorAgent } from '../src/services/agents/supervisor.js';
import { createMarketAnalyst } from '../src/services/agents/market-analyst.js';
import { createCompetitorAnalyst } from '../src/services/agents/competitor-analyst.js';
import { createPricingAnalyst } from '../src/services/agents/pricing-analyst.js';

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log('✓ ' + m); passed++; } else { console.error('✗ ' + m); failed++; } }

const TA = {
  product_id: 'P001',
  competitor_metrics: { seller_price: 1599, competitor_median_price: 1549, seller_vs_median_pct: 3.2 },
  demand: { trend: 'decreasing', change_pct: -5.2 },
  forecast_summary: { status: 'available', expected_mean_daily: 67 },
};
const TC = [{ competitor_id: 'C1', price: 1499 }, { competitor_id: 'C2', price: 1549 }];
const MP = { baseline_price: 1599, scenarios: [{ price: 1499, expected_daily_demand: 75, estimated_daily_revenue: 112425 }] };

console.log('=== MockBedrockClient Tests ===');

const client = new MockBedrockClient();

// Test 1: Market analyst
const mi = { agent: 'market_analyst', product_id: 'P001', question: 'Demand trend?', context: { analysis: TA } };
const mr = await client.converse({ messages: [{ role: 'user', content: [{ text: JSON.stringify(mi) }] }] });
const mo = JSON.parse(mr.output.message.content[0].text);
assert(mo.agent === 'market_analyst', 'Market agent type');
assert(mo.findings.length > 0, 'Market findings');
assert(mo.findings.some(f => f.metric === 'demand.trend'), 'Demand trend finding');
assert(mo.confidence === 'high', 'Market confidence high');

// Test 2: Competitor analyst
const ci = { agent: 'competitor_analyst', product_id: 'P001', question: 'Compare?', context: { analysis: TA, competitors: TC } };
const cr = await client.converse({ messages: [{ role: 'user', content: [{ text: JSON.stringify(ci) }] }] });
const co = JSON.parse(cr.output.message.content[0].text);
assert(co.agent === 'competitor_analyst', 'Competitor agent type');
assert(co.findings.some(f => f.metric === 'seller_price'), 'Has seller price');

assert(co.summary.includes('1549'), 'Summary has median');

// Test 3: Missing data
const msi = { agent: 'market_analyst', product_id: 'P001', question: 'Trend?', context: { analysis: {} } };
const msr = await client.converse({ messages: [{ role: 'user', content: [{ text: JSON.stringify(msi) }] }] });
const mso = JSON.parse(msr.output.message.content[0].text);
assert(mso.missing_data && mso.missing_data.includes('analysis.demand'), 'Missing data flagged');
assert(mso.confidence === 'low', 'Low confidence for missing');

console.log('=== SupervisorAgent Tests ===');

const supervisor = new SupervisorAgent({ bedrockClient: new MockBedrockClient() });
const ctx = { product_id: 'P001', product: { product_id: 'P001', price: 1599 }, analysis: TA, competitors: TC, pricing_scenarios: MP };

// Test 4: Pricing question routes to competitor analyst
const pr = await supervisor.process('Is my price competitive?', ctx);
assert(pr.agents_used.includes('market_analyst'), 'Market analyst called');
assert(pr.agents_used.includes('competitor_analyst'), 'Competitor analyst called');
assert(Array.isArray(pr.analysis_stages), 'Stages returned');
assert(typeof pr.response === 'string', 'Response is string');

// Test 5: What-if routes to pricing analyst
const wr = await supervisor.process('What if I reduce price?', ctx);
assert(wr.agents_used.includes('pricing_analyst'), 'Pricing analyst called');

console.log('=== Specialist Agent Tests ===');

// Test 6: MarketAnalyst
const ma = createMarketAnalyst({ bedrockClient: new MockBedrockClient() });
const mra = await ma.analyze('P001', ctx);
assert(mra.agent === 'market_analyst', 'MarketAnalyst agent');
assert(typeof mra.summary === 'string', 'MarketAnalyst summary');

// Test 7: CompetitorAnalyst
const ca = createCompetitorAnalyst({ bedrockClient: new MockBedrockClient() });
const cra = await ca.analyze('P001', ctx);
assert(cra.agent === 'competitor_analyst', 'CompetitorAnalyst agent');
assert(cra.findings.length > 0, 'CompetitorAnalyst has findings');
assert(cra.findings.some(f => f.metric === 'seller_price') || cra.findings.some(f => f.metric === 'competitor_median_price'), 'CompetitorAnalyst has price findings');

// Test 8: PricingAnalyst
const pa = createPricingAnalyst({ bedrockClient: new MockBedrockClient() });
const pra = await pa.analyze('P001', ctx);
assert(pra.agent === 'pricing_analyst', 'PricingAnalyst agent');
assert(pra.findings.length > 0, 'PricingAnalyst has findings');
assert(pra.findings.some(f => f.metric === 'baseline_price'), 'PricingAnalyst has baseline_price');

console.log('=== Grounding Tests ===');

// Test 9: Values match input
const gc = new MockBedrockClient();
const gi = { agent: 'competitor_analyst', product_id: 'P001', question: 'Compare', context: { analysis: TA } };
const gr = await gc.converse({ messages: [{ role: 'user', content: [{ text: JSON.stringify(gi) }] }] });
const go = JSON.parse(gr.output.message.content[0].text);
const sf = go.findings.find(f => f.metric === 'seller_price');
if (sf) assert(sf.value === 1599, 'Seller price matches 1599');
const mf = go.findings.find(f => f.metric === 'competitor_median_price');
if (mf) assert(mf.value === 1549, 'Median matches 1549');
assert(go.data_sources.length > 0, 'Data sources provided');
assert(go.data_sources.some(s => s.includes('competitor_metrics')), 'Sources reference fields');
const vv = [1599, 1549, 3.2];
const av = go.findings.map(f => f.value).filter(v => typeof v === 'number');
const iv = av.filter(v => !vv.includes(v));
assert(iv.length === 0, 'No invented numbers');

console.log('');
console.log('========================================');
console.log('Tests: ' + (passed + failed) + ' | Passed: ' + passed + ' | Failed: ' + failed);
console.log('========================================');
if (failed > 0) process.exit(1);
