import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore } from '../local/memory-store.mjs'

const dataset = { products: [{ product_id: 'P001', price: 100 }], sales_history: {
  P001: [{ date: '2026-09-02', units_sold: 2 }, { date: '2026-09-01', units_sold: 1 }],
}, competitors: { P001: [
  { competitor_id: 'C001', observation_date: '2026-09-02', price: 100 },
  { competitor_id: 'C001', observation_date: '2026-09-01', price: 90 },
] } }

test('memory store isolates input and returned values, sorts sales and replaces natural keys', async () => {
  const input = structuredClone(dataset)
  const store = createMemoryStore(input)
  input.products[0].price = 999
  assert.equal((await store.getProduct('P001')).price, 100)
  assert.equal(await store.getProduct('UNKNOWN'), null)
  const rows = await store.getSales('P001')
  assert.deepEqual(rows.map((r) => r.units_sold), [1, 2])
  rows[0].units_sold = 999
  const replacement = { date: '2026-09-02', units_sold: 8 }
  await store.putSales('P001', [replacement])
  replacement.units_sold = 0
  assert.deepEqual((await store.getSales('P001')).map((r) => r.units_sold), [1, 8])
  assert.deepEqual(await store.getSales('UNKNOWN'), [])
})

test('latest competitor ignores older uploads and replaces same-date observations', async () => {
  const store = createMemoryStore(dataset)
  await store.putCompetitors('P001', [{ competitor_id: 'C001', observation_date: '2026-08-01', price: 1 }])
  assert.equal((await store.getCompetitorsLatest('P001'))[0].price, 100)
  await store.putCompetitors('P001', [{ competitor_id: 'C001', observation_date: '2026-09-02', price: 110 }])
  assert.equal((await store.getCompetitorsLatest('P001'))[0].price, 110)
  assert.deepEqual(await store.getCompetitorsLatest('UNKNOWN'), [])
})

test('snapshot keys are date-based for same-day idempotency; server stores stay independent', async () => {
  const a = createMemoryStore(dataset), b = createMemoryStore(dataset)
  const snapshot = { product_id: 'P001', generated_at: 'date', analysis_id: 'id' }
  await a.putAnalysis(snapshot)
  // Same-day put overwrites (idempotency by product_id + analysis_date)
  await a.putAnalysis({ ...snapshot, analysis_id: 'id-2' })
  assert.equal((await a.getAnalysis('P001')).analysis_id, 'id-2')
  assert.equal(await b.getAnalysis('P001'), null)
  await a.putProduct({ product_id: 'P001', price: 200 })
  assert.equal((await b.getProducts())[0].price, 100)
})
