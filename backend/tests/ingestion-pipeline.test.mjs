import test from 'node:test'
import assert from 'node:assert/strict'
import { createIngestion } from '../src/ingestion/pipeline.js'
import { createS3ObjectStore } from '../src/services/object-store.js'
import { createLedger } from '../src/services/upload-ledger.js'
import { createMemoryUploadStorage } from '../src/services/memory-upload-storage.js'
import { createHandler } from '../src/handlers/api.mjs'

const csv = 'date,product_id,units_sold,price\n2026-09-01,P001,10,100\n2026-09-02,P001,10,100\n2026-09-03,P001,10,100'
function fixture({ failLedger = 0, failObject = 0, failSales = false, failAnalysis = false } = {}) {
  const objects = [], records = new Map(), checkpoints = [], sales = [], snapshots = []
  let ledgerCalls = 0
  const ledger = createLedger({ send: async ({ input }) => {
    if (input.Key) return { Item: structuredClone(records.get(input.Key.SK)) }
    if (++ledgerCalls === failLedger) throw new Error('Private ledger failure')
    const exists = records.has(input.Item.SK)
    if (input.ConditionExpression.includes('attribute_not_exists') === exists) throw new Error('Condition failed')
    records.set(input.Item.SK, structuredClone(input.Item))
    checkpoints.push(structuredClone(input.Item.data))
    return {}
  } }, 'offline-table')
  const objectStore = createS3ObjectStore({ send: async ({ input }) => {
    objects.push(input)
    if (objects.length === failObject) throw new Error('Private artifact failure')
    assert.equal(typeof input.Body, 'string')
    return { ETag: 'offline' }
  } }, 'offline-bucket')
  const store = {
    getProducts: async () => [{ product_id: 'P001', price: 100 }],
    getProduct: async () => ({ product_id: 'P001', price: 100 }),
    putSales: async (id, rows) => { if (failSales) throw new Error('Private dataset failure'); sales.push(...rows) },
    putCompetitors: async () => { throw new Error('Unexpected competitor write') },
    getSales: async () => sales,
    getCompetitorsLatest: async () => [{ product_id: 'P001', competitor_id: 'C001', price: 100 }],
    putAnalysis: async (snapshot) => { if (failAnalysis) throw new Error('Private snapshot failure'); snapshots.push(snapshot) },
  }
  return { store, objects, checkpoints, sales, snapshots, ledger, objectStore,
    run: () => createIngestion({ objectStore, ledger })(store, 'sales', csv) }
}

test('real S3 + ledger adapters preserve artifacts, analysis and final outcome offline', async () => {
  const f = fixture()
  const response = await f.run()
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.status, 'accepted')
  assert.equal(f.objects[0].Body, csv)
  assert.equal(f.objects[0].ContentType, 'text/csv; charset=utf-8')
  assert.equal(f.objects[1].ContentType, 'application/json')
  assert.deepEqual(JSON.parse(f.objects[1].Body).records, f.sales)
  assert.equal(f.snapshots.length, 1)
  // Existing short-history weekday fallback: 2 weeks × (3 × 21 + 4 × 2).
  // Pins current calculation, not evidence that three days produce reliable forecasts.
  assert.equal(f.snapshots[0].forecast_summary.total_expected_14d, 142)
  assert.equal(f.checkpoints.length, 11)
  const saved = await f.ledger.getUpload(response.body.upload_id)
  assert.equal(saved.status, 'accepted')
  assert.equal(saved.acknowledged_rows, 3)
  assert.equal(saved.analysis[0].analysis_id, f.snapshots[0].analysis_id)
})

for (let failLedger = 1; failLedger <= 11; failLedger++) {
  test(`ledger failure at checkpoint ${failLedger} never reports full success`, async (t) => {
    t.mock.method(console, 'error', () => {})
    const f = fixture({ failLedger })
    const { statusCode, body } = await f.run()
    assert.equal(statusCode, 500)
    assert.equal(body.status, 'incomplete')
    assert.equal(body.failure_stage, 'ledger')
    assert.equal(body.ledger_acknowledged, false)
    assert.equal(JSON.stringify(body).includes('Private'), false)
    if (failLedger <= 2) assert.equal(f.objects.length, 0)
    if (failLedger <= 6) assert.equal(f.sales.length, 0)
    if (failLedger <= 9) assert.equal(f.snapshots.length, 0)
  })
}
for (const failObject of [1, 2]) {
  test(`artifact ${failObject} failure prevents all dataset writes`, async (t) => {
    t.mock.method(console, 'error', () => {})
    const f = fixture({ failObject })
    const response = await f.run()
    assert.equal(response.statusCode, 500)
    assert.equal(response.body.ledger_acknowledged, true)
    assert.equal(response.body.artifacts[failObject === 1 ? 'raw' : 'normalized'], 'uncertain')
    assert.equal(f.sales.length, 0)
    assert.equal(f.snapshots.length, 0)
    assert.equal(f.checkpoints.at(-1).status, 'incomplete')
  })
}

test('dataset timeout retains artifacts and records uncertain rows without analysis', async (t) => {
  t.mock.method(console, 'error', () => {})
  const f = fixture({ failSales: true })
  const response = await f.run()
  assert.equal(response.statusCode, 500)
  assert.equal(response.body.uncertain_rows, 3)
  assert.equal(response.body.not_attempted_rows, 0)
  assert.equal(f.objects.length, 2)
  assert.equal(f.snapshots.length, 0)
})

test('analysis save failure preserves accepted dataset with explicit warning', async (t) => {
  t.mock.method(console, 'error', () => {})
  const f = fixture({ failAnalysis: true })
  const response = await f.run()
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.status, 'accepted_with_analysis_warnings')
  assert.equal(response.body.analysis[0].status, 'save_uncertain')
  assert.equal(f.sales.length, 3)
  assert.equal(f.checkpoints.at(-1).status, response.body.status)
})


test('outcome route supports named/stage-free paths and returns 400/404 safely', async () => {
  const f = fixture()
  const response = await f.run()
  const handle = createHandler(f.store, f)
  for (const prefix of ['/prod/api', '/api']) {
    const result = await handle({ rawPath: `${prefix}/data/uploads/${response.body.upload_id}`,
      requestContext: { stage: 'prod', http: { method: 'GET' } } })
    assert.equal(result.statusCode, 200)
    assert.equal(JSON.parse(result.body).status, 'accepted')
  }
  for (const [id, status] of [['bad', 400], ['00000000-0000-4000-8000-000000000000', 404]]) {
    const result = await handle({ rawPath: `/api/data/uploads/${id}`,
      requestContext: { stage: '$default', http: { method: 'GET' } } })
    assert.equal(result.statusCode, status)
  }
  const extra = await handle({ rawPath: `/api/data/uploads/${response.body.upload_id}/extra`,
    requestContext: { stage: '$default', http: { method: 'GET' } } })
  assert.equal(extra.statusCode, 404)
})

test('memory adapters share the pipeline and isolate stored values', async () => {
  const f = fixture()
  const memory = createMemoryUploadStorage()
  const response = await createIngestion(memory)(f.store, 'sales', csv)
  assert.equal(response.body.status, 'accepted')
  assert.equal(memory.objects.size, 2)
  response.body.analysis[0].status = 'mutated'
  const saved = await memory.ledger.getUpload(response.body.upload_id)
  assert.equal(saved.analysis[0].status, 'completed')
  assert.equal(await memory.ledger.getUpload('missing'), null)
})

test('invalid CSV and unknown products create no artifacts or ledger entries', async () => {
  const f = fixture()
  const run = createIngestion(f)
  await assert.rejects(run(f.store, 'sales', 'invalid'), (err) => err.statusCode === 422)
  await assert.rejects(run(f.store, 'sales', csv.replaceAll('P001', 'UNKNOWN')), (err) => err.statusCode === 422)
  assert.equal(f.objects.length, 0)
  assert.equal(f.checkpoints.length, 0)
})

test('S3 rejects invalid keys and object bodies before transport', async () => {
  const put = createS3ObjectStore({ send: async () => { assert.fail('No transport expected') } }, 'offline')
  await assert.rejects(put('../data', 'x', 'application/json'), TypeError)
  await assert.rejects(put('data', {}, 'application/json'), TypeError)
})
