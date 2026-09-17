import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore } from '../local/memory-store.mjs'
import { createStore } from '../src/services/store-adapter.js'
import { normalizeStoredDate } from '../src/services/stored-date.js'

const sale = { date: '2026-09-01T00:00:00.000Z', units_sold: 10, price: 100 }
const comp = { competitor_id: 'C001', observation_date: '2026-09-01T00:00:00.000Z', price: 90 }

test('legacy seed dates have identical local/DynamoDB read contracts without writes', async () => {
  const memory = createMemoryStore({ products: [{ product_id: 'P001' }],
    sales_history: { P001: [sale] }, competitors: { P001: [comp] } })
  const cloud = createStore({ send: async ({ input }) => {
    assert.equal(input.ConsistentRead, true)
    const row = input.ExpressionAttributeValues[':prefix'] === 'SALES#' ? sale : comp
    return { Items: [{ data: row }] }
  } }, 'offline-table')
  assert.deepEqual(await cloud.getSales('P001'), await memory.getSales('P001'))
  assert.equal((await cloud.getSales('P001'))[0].date, '2026-09-01')
  assert.deepEqual(await cloud.getCompetitorsLatest('P001'), await memory.getCompetitorsLatest('P001'))
  assert.equal(sale.date, '2026-09-01T00:00:00.000Z')
  assert.equal(comp.observation_date, '2026-09-01T00:00:00.000Z')
})

test('date compatibility does not silently convert arbitrary timestamps or invalid dates', () => {
  for (const date of ['2026-09-01T12:00:00.000Z', '09/01/2026', '2026-02-30', 'bad']) {
    assert.equal(normalizeStoredDate({ date }, 'date').date, date)
  }
  assert.equal(normalizeStoredDate({ date: '2026-02-30T00:00:00.000Z' }, 'date').date, '2026-02-30')
  // The existing analysis/forecast guards still reject this invalid calendar date.
})
