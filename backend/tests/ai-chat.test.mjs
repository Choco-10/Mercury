import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../src/handlers/api.mjs'

// Offline route tests for POST /api/ai/chat (multi-agent, Mock Bedrock by default).
// Storage is an injected fake; no AWS client, credentials or network requests.
const product = { product_id: 'P001', title: 'Test Earbuds', price: 100, rating: 4.2 }
const sales = Array.from({ length: 28 }, (_, i) => ({
  product_id: 'P001', date: `2026-09-${String(i + 1).padStart(2, '0')}`, units_sold: 10,
}))
const competitors = [
  { product_id: 'P001', competitor_id: 'C001', price: 100 },
  { product_id: 'P001', competitor_id: 'C002', price: 90 },
]

function fixture() {
  const written = []
  const unused = async () => { throw new Error('Unexpected storage operation') }
  const store = {
    putSales: unused,
    putCompetitors: unused,
    putAnalysis: async (snapshot) => { written.push(snapshot) },
    // No same-day snapshot by default: the handler computes and saves one.
    getAnalysis: async () => null,
    getProducts: async () => [product],
    getProduct: async (id) => (id === 'P001' ? product : null),
    getSales: async () => sales,
    getCompetitorsLatest: async () => competitors,
  }
  const handle = createHandler(store)
  async function chat(bodyText) {
    const result = await handle({
      version: '2.0', rawPath: '/api/ai/chat', routeKey: 'POST /api/ai/chat',
      requestContext: { stage: '$default', http: { method: 'POST' } },
      body: bodyText, isBase64Encoded: false,
    })
    return { status: result.statusCode, body: result.body ? JSON.parse(result.body) : null }
  }
  return { chat, written }
}

test('POST /ai/chat accepts the frontend question contract and returns grounded fields', async () => {
  const { chat, written } = fixture()
  const { status, body } = await chat(JSON.stringify({
    product_id: 'P001', question: 'Why should I investigate my current pricing?',
  }))
  assert.equal(status, 200)
  assert.equal(body.answer, body.response)
  assert.equal(typeof body.response, 'string')
  assert.ok(body.response.length > 0)
  assert.ok(Array.isArray(body.analysis_stages))
  assert.ok(Array.isArray(body.data_sources) && body.data_sources.length > 0)
  assert.ok(['high', 'medium', 'low'].includes(body.confidence))
  assert.ok(Array.isArray(body.agents_used) && body.agents_used.length > 0)
  assert.ok(Array.isArray(body.suggested_follow_up) && body.suggested_follow_up.length > 0)
  // The deterministic analysis was computed once and stored for same-day reuse.
  assert.equal(written.length, 1)
  assert.equal(written[0].product_id, 'P001')
  assert.equal(body.missing_data, undefined)
})

test('POST /ai/chat still accepts the legacy message field', async () => {
  const { chat } = fixture()
  const { status, body } = await chat(JSON.stringify({ product_id: 'P001', message: 'Explain the 14-day forecast.' }))
  assert.equal(status, 200)
  assert.equal(typeof body.response, 'string')
})

test('POST /ai/chat rejects requests without a question or message', async () => {
  const { chat } = fixture()
  assert.equal((await chat(JSON.stringify({ product_id: 'P001' }))).status, 400)
  assert.equal((await chat(JSON.stringify({}))).status, 400)
})

test('POST /ai/chat rejects requests without product_id', async () => {
  const { chat } = fixture()
  const { status } = await chat(JSON.stringify({ question: 'What changed recently?' }))
  assert.equal(status, 400)
})

test('POST /ai/chat returns 404 for an unknown product', async () => {
  const { chat } = fixture()
  const { status } = await chat(JSON.stringify({ product_id: 'MISSING', question: 'What are my competitive risks?' }))
  assert.equal(status, 404)
})
