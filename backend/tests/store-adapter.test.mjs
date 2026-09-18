import test from 'node:test'
import assert from 'node:assert/strict'
import { GetCommand, PutCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'
import { createStore } from '../src/services/store-adapter.js'
import { createHandler } from '../src/handlers/api.mjs'
import { createMemoryUploadStorage } from '../src/services/memory-upload-storage.js'


const table = 'offline-table'
function fixture(respond, options = {}) {
  const commands = []
  const store = createStore({ send: async (command) => {
    commands.push(command)
    return respond(command, commands.length)
  } }, table, { delay: async () => {}, random: () => 0, ...options })
  return { store, commands }
}

for (const [method, pk, prefix] of [
  ['getProducts', 'SELLER#SELLER001', 'PRODUCT#'],
  ['getSales', 'PRODUCT#P001', 'SALES#'],
  ['getCompetitorsLatest', 'PRODUCT#P001', 'COMPETITOR#'],
]) {
  test(`${method} traverses pages with its own key prefix`, async () => {
    const a = { product_id: 'P001', date: '2026-09-02', competitor_id: 'C001', observation_date: '2026-09-02' }
    const b = { product_id: 'P002', date: '2026-09-01', competitor_id: 'C002', observation_date: '2026-09-01' }
    const cursor = { PK: pk, SK: `${prefix}cursor` }
    const { store, commands } = fixture((c, count) => count === 1
      ? { Items: [{ data: a }], LastEvaluatedKey: cursor } : { Items: [{ data: b }] })
    const result = await store[method]('P001')
    assert.deepEqual(result, method === 'getSales' ? [b, a] : [a, b])
    assert.equal(commands.length, 2)
    for (const command of commands) {
      assert.ok(command instanceof QueryCommand)
      assert.equal(command.input.TableName, table)
      assert.equal(command.input.KeyConditionExpression, 'PK = :pk AND begins_with(SK, :prefix)')
      assert.deepEqual(command.input.ExpressionAttributeValues, { ':pk': pk, ':prefix': prefix })
    }
    assert.deepEqual(commands[1].input.ExclusiveStartKey, cursor)
  })
}

test('latest competitors selected across every page, including special string IDs', async () => {
  const row = (id, date, price) => ({ competitor_id: id, observation_date: date, price })
  const old = row('C001', '2026-09-01', 90)
  const latest = row('C001', '2026-09-03', 100)
  const special = row('__proto__', '2026-09-01', 70)
  const { store } = fixture((c, count) => count === 1
    ? { Items: [{ data: old }, { data: special }], LastEvaluatedKey: { PK: 'p', SK: 's' } }
    : { Items: [{ data: latest }, { data: row('C001', '2026-09-02', 95) }] })
  assert.deepEqual(await store.getCompetitorsLatest('P001'), [latest, special])
})

test('single product get and put preserve the data contract', async () => {
  const product = { product_id: 'P001', price: 100 }
  const { store, commands } = fixture((c, count) => count === 1 ? { Item: { data: product } } : {})
  assert.deepEqual(await store.getProduct('P001'), product)
  assert.equal(await store.getProduct('MISSING'), null)
  await store.putProduct(product)
  assert.ok(commands[0] instanceof GetCommand)
  assert.deepEqual(commands[0].input, { TableName: table, Key: { PK: 'SELLER#SELLER001', SK: 'PRODUCT#P001' } })
  assert.ok(commands[2] instanceof PutCommand)
  assert.deepEqual(commands[2].input.Item, { PK: 'SELLER#SELLER001', SK: 'PRODUCT#P001', data: product })
})

test('sales and competitor writes construct unchanged natural keys', async () => {
  const { store, commands } = fixture(() => ({}))
  const sale = { date: '2026-09-01', product_id: 'P001', units_sold: 1, price: 100 }
  const competitor = { observation_date: '2026-09-02', competitor_id: 'C001', price: 90 }
  await store.putSales('P001', [sale])
  await store.putCompetitors('P001', [competitor])
  assert.ok(commands.every((c) => c instanceof BatchWriteCommand))
  assert.deepEqual(commands.map((c) => c.input.RequestItems[table]), [
    [{ PutRequest: { Item: { PK: 'PRODUCT#P001', SK: 'SALES#2026-09-01', data: sale } } }],
    [{ PutRequest: { Item: { PK: 'PRODUCT#P001', SK: 'COMPETITOR#C001#2026-09-02', data: competitor } } }],
  ])
})

test('analysis writer remains connected to injected transport and uses a date key', async () => {
  const { store, commands } = fixture(() => ({}))
  await store.putAnalysis({ product_id: 'P001', generated_at: '2026-09-01T00:00:00.000Z', analysis_id: 'test-id' })
  assert.ok(commands[0] instanceof PutCommand)
  assert.equal(commands[0].input.Item.SK, 'ANALYSIS#2026-09-01')
})

test('analysis reader fetches the same-day key via GetCommand', async () => {
  const { store, commands } = fixture(() => ({ Item: { data: { product_id: 'P001' } } }))
  assert.deepEqual(await store.getAnalysis('P001'), { product_id: 'P001' })
  assert.ok(commands[0] instanceof GetCommand)
  assert.deepEqual(commands[0].input.Key, {
    PK: 'PRODUCT#P001', SK: `ANALYSIS#${new Date().toISOString().slice(0, 10)}`,
  })
})

test('router with real adapter reports exhausted upload writes as 500', async (t) => {
  t.mock.method(console, 'error', () => {})
  const { store, commands } = fixture((command) => {
    if (command instanceof QueryCommand) return { Items: [{ data: { product_id: 'P001' } }] }
    assert.ok(command instanceof BatchWriteCommand)
    return { UnprocessedItems: command.input.RequestItems }
  }, { maxRetries: 1 })
  const result = await createHandler(store, createMemoryUploadStorage())({
    version: '2.0', rawPath: '/api/data/upload',
    requestContext: { stage: '$default', http: { method: 'POST' } },
    body: JSON.stringify({ type: 'sales', csv: 'date,product_id,units_sold,price\n2026-09-01,P001,2,100' }),
  })
  assert.equal(result.statusCode, 500)
  const outcome = JSON.parse(result.body)
  assert.equal(outcome.status, 'incomplete')
  assert.equal(outcome.acknowledged_rows, 0)
  assert.equal(outcome.uncertain_rows, 1)
  assert.equal(outcome.not_attempted_rows, 0)
  assert.equal(commands.length, 3)
})

test('router GET includes all product pages through the actual adapter', async () => {
  const { store } = fixture((command, count) => count === 1
    ? { Items: [{ data: { product_id: 'P001' } }], LastEvaluatedKey: { PK: 'SELLER#SELLER001', SK: 'PRODUCT#P001' } }
    : { Items: [{ data: { product_id: 'P002' } }] })
  const result = await createHandler(store)({
    version: '2.0', rawPath: '/prod/api/products',
    requestContext: { stage: 'prod', http: { method: 'GET' } },
  })
  assert.equal(result.statusCode, 200)
  assert.deepEqual(JSON.parse(result.body), [{ product_id: 'P001' }, { product_id: 'P002' }])
})
