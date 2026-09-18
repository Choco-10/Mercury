import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../src/handlers/api.mjs'
import { createMemoryUploadStorage } from '../src/services/memory-upload-storage.js'

import { createStore } from '../src/services/store-adapter.js'
import { QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'
const header = 'date,product_id,units_sold,price'
const valid = `${header}\n2026-09-01,P001,2,100`

function fixture(overrides = {}) {
  const writes = []
  let reads = 0
  const unused = async () => { throw new Error('Unexpected access') }
  const store = {
    getProducts: async () => { reads++; return ['P001', 'P002', 'P003'].map((product_id) => ({ product_id })) },
    getProduct: unused, getSales: async () => [], getCompetitorsLatest: async () => [],
    putAnalysis: unused, getAnalysis: unused,
    putSales: async (id, rows) => { writes.push([id, rows]) },
    putCompetitors: async (id, rows) => { writes.push([id, rows]) }, ...overrides,
  }
  return { handle: createHandler(store, createMemoryUploadStorage()), writes, reads: () => reads }
}
function event(csv, options = {}) {
  return { version: '2.0', rawPath: '/prod/api/data/upload',
    requestContext: { stage: 'prod', http: { method: 'POST' } },
    body: JSON.stringify({ type: 'sales', csv }), ...options }
}

test('valid sales accepted only after normalized writes are acknowledged', async () => {
  const f = fixture()
  const result = await f.handle(event(valid))
  assert.equal(result.statusCode, 200)
  const body = JSON.parse(result.body)
  assert.equal(body.status, 'accepted_with_analysis_warnings')
  assert.equal(body.analysis[0].status, 'unavailable')
  assert.equal(body.acknowledged_rows, 1)
  assert.equal(body.uncertain_rows, 0)
  assert.match(body.upload_id, /^[0-9a-f-]{36}$/)
  assert.deepEqual(f.writes, [['P001', [{ date: '2026-09-01', product_id: 'P001', units_sold: 2, price: 100 }]]])
})

test('base64 and stage-free upload of competitors preserves quoted title', async () => {
  const f = fixture()
  const csv = 'observation_date,product_id,competitor_id,title,price,rating,discount\n2026-09-01,P001,C001,"One, Two",90,4,10'
  const response = await f.handle(event(csv, { rawPath: '/api/data/upload', isBase64Encoded: true,
    body: Buffer.from(JSON.stringify({ type: 'competitors', csv })).toString('base64') }))
  assert.equal(response.statusCode, 200)
  assert.equal(f.writes[0][1][0].title, 'One, Two')
  assert.equal(Object.values(f.writes[0][1][0]).includes(undefined), false)
})

for (const csv of [`${valid}\n2026-02-30,P001,1,100`, `${valid}\n2026-09-01,P001,3,100`]) {
  test('late invalid row or duplicate rejects whole file before any storage access', async () => {
    const f = fixture()
    assert.equal((await f.handle(event(csv))).statusCode, 422)
    assert.equal(f.reads(), 0)
    assert.deepEqual(f.writes, [])
  })
}

test('unknown product rejects entire multi-product file before writes', async () => {
  const f = fixture()
  const response = await f.handle(event(`${valid}\n2026-09-01,P999,1,100`))
  assert.equal(response.statusCode, 422)
  assert.deepEqual(JSON.parse(response.body).issues, ['Unknown product_id: P999'])
  assert.equal(f.reads(), 1)
  assert.deepEqual(f.writes, [])
})

test('size limit rejects request before reads', async () => {
  const f = fixture()
  assert.equal((await f.handle(event('a'.repeat(262145)))).statusCode, 413)
  assert.equal((await f.handle(event('', { body: 'a'.repeat(2 * 1024 * 1024 + 1) }))).statusCode, 413)
  assert.equal(f.reads(), 0)
})

test('catalog read failure never writes data', async (t) => {
  t.mock.method(console, 'error', () => {})
  const f = fixture({ getProducts: async () => { throw new Error('Private database detail') } })
  const response = await f.handle(event(valid))
  assert.equal(response.statusCode, 500)
  assert.deepEqual(f.writes, [])
  assert.equal(response.body.includes('Private'), false)
})

test('partial group failure preserves acknowledged writes and stops subsequent groups', async (t) => {
  t.mock.method(console, 'error', () => {})
  const attempted = []
  const f = fixture({ putSales: async (id) => {
    attempted.push(id)
    if (id === 'P002') throw new Error('Ambiguous write timeout')
  } })
  const response = await f.handle(event(`${valid}\n2026-09-01,P002,3,100\n2026-09-01,P003,4,100`))
  assert.equal(response.statusCode, 500)
  const outcome = JSON.parse(response.body)
  assert.deepEqual(attempted, ['P001', 'P002'])
  assert.equal(outcome.status, 'incomplete')
  assert.equal(outcome.acknowledged_rows, 1)
  assert.equal(outcome.uncertain_rows, 1)
  assert.equal(outcome.not_attempted_rows, 1)
  assert.equal(outcome.partial_writes_possible, true)
  assert.equal(response.body.includes('timeout'), false)
})

test('actual adapter receives clean normalized records with no undefined properties', async () => {
  const commands = []
  const store = createStore({ send: async (command) => {
    commands.push(command)
    if (command instanceof QueryCommand) return { Items: command.input.ExpressionAttributeValues[':prefix'] === 'PRODUCT#'
      ? [{ data: { product_id: 'P001', price: 100 } }] : [] }
    assert.ok(command instanceof BatchWriteCommand)
    assert.deepEqual(JSON.parse(JSON.stringify(command.input)), command.input)
    return {}
  } }, 'offline-table')
  assert.equal((await createHandler(store, createMemoryUploadStorage())(event(valid))).statusCode, 200)
  assert.equal(commands.length, 4)
})
