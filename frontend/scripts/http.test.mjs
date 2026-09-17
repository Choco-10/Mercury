import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpClient, ApiError } from '../src/services/http.js'
import { createLocalServer } from '../../backend/local/server.mjs'
import { getDemoDataset } from '../src/data/demoData.js'

for (const baseUrl of ['https://example.com', 'http://example.com', 'http://127.0.0.1:3001/api', 'http://localhost:3001/prod', 'http://user:pass@localhost:3001', 'http://localhost:3001?x=1']) {
  test(`localhost refuses non-loopback or ambiguous base: ${baseUrl}`, () => {
    assert.throws(() => createHttpClient({ mode: 'localhost', baseUrl }))
  })
}

test('invalid mode and AWS base fail closed', () => {
  assert.throws(() => createHttpClient({ mode: 'awz' }))
  assert.throws(() => createHttpClient({ mode: 'aws' }))
  assert.throws(() => createHttpClient({ mode: 'aws', baseUrl: 'http://example.com' }))
  assert.throws(() => createHttpClient({ mode: 'aws', baseUrl: 'https://example.com/prod/api' }))
})

test('browser demo never sends uploads, even with a cloud URL supplied', async () => {
  const client = createHttpClient({ mode: 'local', baseUrl: 'https://example.com', fetchImpl: () => assert.fail('Unexpected network call') })
  await assert.rejects(client.post('/data/upload', {}), /does not persist/)
})

test('AWS path shape and credentials are checked with fake transport only', async () => {
  const calls = []
  const client = createHttpClient({ mode: 'aws', baseUrl: 'https://example.invalid/prod/', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ ok: true }))
  } })
  await client.get('/products')
  await client.post('/data/upload', { type: 'sales', csv: 'data' })
  assert.equal(calls[0].url, 'https://example.invalid/prod/api/products')
  assert.equal(calls[1].url, 'https://example.invalid/prod/api/data/upload')
  assert.equal(calls[1].options.credentials, 'omit')
  assert.equal(calls[1].options.redirect, 'error')
  assert.equal(calls[1].options.body, JSON.stringify({ type: 'sales', csv: 'data' }))
})

for (const status of [422, 500]) {
  test(`HTTP ${status} preserves validation/outcome details`, async () => {
    const details = { error: 'Review upload', issues: ['Bad date'], upload_id: 'test-id', status: 'incomplete' }
    const client = createHttpClient({ mode: 'localhost', fetchImpl: async () => new Response(JSON.stringify(details), { status }) })
    await assert.rejects(client.post('/data/upload', {}), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, status)
      assert.deepEqual(err.details, details)
      return true
    })
  })
}

test('network write failure is uncertain, not auto-retried', async () => {
  let calls = 0
  const client = createHttpClient({ mode: 'localhost', fetchImpl: async () => { calls++; throw new Error('network') } })
  await assert.rejects(client.post('/data/upload', {}), /may have completed/)
  assert.equal(calls, 1)
})

test('non-JSON response reports uncertainty without displaying server HTML', async () => {
  const client = createHttpClient({ mode: 'localhost', fetchImpl: async () => new Response('<html>bad gateway</html>', { status: 502 }) })
  await assert.rejects(client.post('/data/upload', {}), /unreadable response/)
})

test('frontend HTTP client → real local router → upload → ledger and updated analytics', async (t) => {
  const server = createLocalServer(getDemoDataset())
  const baseUrl = await server.listen(0)
  t.after(() => server.close())
  const client = createHttpClient({ mode: 'localhost', baseUrl })
  const before = await client.get('/products/P001/sales')
  const csv = `date,product_id,units_sold,price\n${before.at(-1).date},P001,77,100`
  const result = await client.post('/data/upload', { type: 'sales', csv })
  assert.equal(result.status, 'accepted')
  assert.equal(result.analysis[0].status, 'completed')
  const outcome = await client.get(`/data/uploads/${result.upload_id}`)
  assert.equal(outcome.status, 'accepted')
  const after = await client.get('/products/P001/sales')
  assert.equal(after.length, before.length)
  assert.equal(after.at(-1).units_sold, 77)
  assert.equal((await client.get('/products/P001/forecast')).forecast.length, 14)
  assert.equal((await client.get('/products/P001/analysis')).product_id, 'P001')
  await assert.rejects(client.post('/data/upload', { type: 'sales', csv: csv.replace(',77,', ',-1,') }), (err) => err.status === 422)
  assert.deepEqual(await client.get('/products/P001/sales'), after)
})
