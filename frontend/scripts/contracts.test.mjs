import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as demo from '../src/services/api.js'
import { createHandler } from '../../backend/src/handlers/api.mjs'
import { createMemoryStore } from '../../backend/local/memory-store.mjs'
import { getDemoDataset } from '../src/data/demoData.js'

const store = createMemoryStore(getDemoDataset())
const handler = createHandler(store)
async function backend(id, sub, body) {
  const result = await handler({ version: '2.0', rawPath: `/api/products/${id}${sub ? `/${sub}` : ''}`,
    requestContext: { stage: '$default', http: { method: body ? 'POST' : 'GET' } },
    pathParameters: { id }, body: body ? JSON.stringify(body) : undefined })
  assert.equal(result.statusCode, 200, result.body)
  return JSON.parse(result.body)
}
const withoutTimestamp = (value) => { const copy = structuredClone(value); delete copy.generated_at; return copy }

for (const id of ['P001', 'P002', 'P003', 'P004', 'P005']) {
  test(`${id}: browser demo and backend agree on product, pricing, forecast numbers and analysis`, async () => {
    const product = await demo.fetchProduct(id)
    assert.deepEqual(await backend(id), product)
    const prices = [product.price * 0.9, product.price, product.price * 1.1]
    assert.deepEqual(await backend(id, 'simulate-price', { scenario_prices: prices }), await demo.simulatePrice(id, prices))
    assert.deepEqual((await backend(id, 'forecast')).forecast, (await demo.fetchForecast(id)).forecast)
    assert.deepEqual(withoutTimestamp(await backend(id, 'analysis')), withoutTimestamp(await demo.fetchAnalysis(id)))
  })
}

test('packaged shared analytics matches canonical source byte-for-byte', async () => {
  assert.equal(await readFile(new URL('../../shared/analytics.js', import.meta.url), 'utf8'),
    await readFile(new URL('../../backend/src/shared/analytics.js', import.meta.url), 'utf8'))
})
