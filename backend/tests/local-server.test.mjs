import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { createLocalServer } from '../local/server.mjs'
import { getDemoDataset } from '../../frontend/src/data/demoData.js'

async function start(t) {
  const app = createLocalServer(getDemoDataset())
  const base = await app.listen(0)
  t.after(() => app.close())
  return base
}
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('real HTTP: demo reads, pricing, analysis, upload replacement and outcome lookup', async (t) => {
  const base = await start(t)
  const products = await (await fetch(`${base}/api/products`)).json()
  assert.equal(products.length, 5)
  const product = await (await fetch(`${base}/api/products/P001`)).json()
  assert.equal(product.product_id, 'P001')
  const sales = await (await fetch(`${base}/api/products/P001/sales`)).json()
  assert.equal(sales.length, 120)
  const forecast = await (await fetch(`${base}/api/products/P001/forecast`)).json()
  assert.equal(forecast.forecast.length, 14)
  assert.equal((await (await fetch(`${base}/api/products/P001/competitors`)).json()).length, 5)
  const simulation = await fetch(`${base}/api/products/P001/simulate-price`, post({ scenario_prices: [product.price] }))
  assert.equal(simulation.status, 200)
  assert.equal((await simulation.json()).scenarios[0].price_change_pct, 0)
  const analyzed = await fetch(`${base}/api/products/P001/analyze`, post({}))
  assert.equal(analyzed.status, 200)
  assert.ok((await analyzed.json()).analysis_id)
  const date = sales.at(-1).date
  const csv = `date,product_id,units_sold,price\n${date},P001,77,${product.price}`
  const upload = await fetch(`${base}/api/data/upload`, post({ type: 'sales', csv }))
  assert.equal(upload.status, 200)
  const outcome = await upload.json()
  assert.equal(outcome.status, 'accepted')
  assert.equal(outcome.analysis[0].status, 'completed')
  const saved = await (await fetch(`${base}/api/data/uploads/${outcome.upload_id}`)).json()
  assert.equal(saved.analysis[0].analysis_id, outcome.analysis[0].analysis_id)
  const changed = await (await fetch(`${base}/api/products/P001/sales`)).json()
  assert.equal(changed.length, 120)
  assert.equal(changed.at(-1).units_sold, 77)
})

test('real HTTP: client errors, exact paths and invalid upload leave dataset unchanged', async (t) => {
  const base = await start(t)
  for (const path of ['/api/products/UNKNOWN', '/api/products/P001/extra/sales', '/products', '/apix/products']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404)
  }
  assert.equal((await fetch(`${base}/api/products/P001/simulate-price`, post({ scenario_prices: [0] }))).status, 400)
  assert.equal((await fetch(`${base}/api/data/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400)
  assert.equal((await fetch(`${base}/api/data/upload`, { method: 'POST', body: '{}' })).status, 415)
  const before = await (await fetch(`${base}/api/products/P001/sales`)).json()
  const result = await fetch(`${base}/api/data/upload`, post({ type: 'sales', csv: 'date,product_id,units_sold,price\n2026-02-30,P001,1,100' }))
  assert.equal(result.status, 422)
  assert.deepEqual(await (await fetch(`${base}/api/products/P001/sales`)).json(), before)
})

test('real HTTP: restricted CORS preflight and loopback Host validation', async (t) => {
  const base = await start(t)
  const allowed = await fetch(`${base}/api/products`, { headers: { Origin: 'http://localhost:5173' } })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  const preflight = await fetch(`${base}/api/data/upload`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173' } })
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/)
  const denied = await fetch(`${base}/api/products`, { headers: { Origin: 'https://example.com' } })
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
  const hostStatus = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/products`, { headers: { Host: 'example.com' } }, (res) => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject); req.end()
  })
  assert.equal(hostStatus, 403)
})

test('real HTTP: streamed oversized body rejected before route', async (t) => {
  const base = await start(t)
  const status = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/data/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      res.resume(); resolve(res.statusCode)
    })
    req.on('error', reject)
    for (let i = 0; i < 33; i++) req.write('a'.repeat(65536))
    req.end()
  })
  assert.equal(status, 413)
  assert.equal((await fetch(`${base}/api/products`)).status, 200)
})
