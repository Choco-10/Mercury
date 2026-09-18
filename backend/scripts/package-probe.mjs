import assert from 'node:assert/strict'
import { request } from 'node:http'
import http from 'node:http'
import https from 'node:https'
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client } from '@aws-sdk/client-s3'

// Installed SDK modules are real; every transport is replaced before production wiring imports.
const deny = () => { throw new Error('Network forbidden in package probe') }
http.request = deny
https.request = deny
globalThis.fetch = deny
assert.notEqual(http.request, request)
S3Client.prototype.send = deny
const product = { product_id: 'P001', price: 100 }
let calls = 0
DynamoDBDocumentClient.prototype.send = async function (command) {
  calls++
  if (command instanceof GetCommand) return { Item: { data: product } }
  if (command instanceof QueryCommand) {
    const prefix = command.input.ExpressionAttributeValues[':prefix']
    if (prefix === 'PRODUCT#') return { Items: [{ data: product }] }
    if (prefix === 'SALES#') return { Items: [{ data: { product_id: 'P001', date: '2026-09-01', units_sold: 10 } }] }
  }
  throw new Error('Unexpected SDK operation')
}
// The shared preparer is packaged and importable without repository-relative imports.
const { prepareDailySeries, addDaysUTC } = await import('./shared/series.js')
const prepared = prepareDailySeries(Array.from({ length: 28 }, (_, i) => ({
  date: addDaysUTC('2024-02-01', i), units_sold: 0,
})))
assert.equal(prepared.ok, true)
assert.equal(prepared.series.flags.meetsMinimumHistory, true)
assert.equal(addDaysUTC(prepared.series.lastDate, 1), '2024-02-29')


const { createForecastService } = await import('./shared/forecast-service.js')
const unavailableForecast = await createForecastService({
  loadSales: async () => [], provider: { predict: deny },
  now: () => new Date('2024-03-01T00:00:00Z'),
}).predict('P001')
assert.equal(unavailableForecast.reason, 'insufficient_history')
assert.deepEqual(unavailableForecast.forecast, [])

const { handler } = await import('./handlers/api.mjs')
const event = (method, path, body) => ({
  version: '2.0', rawPath: `/prod/api${path}`,
  requestContext: { stage: 'prod', http: { method } },
  pathParameters: { id: 'P001' }, body: body ? JSON.stringify(body) : undefined,
})
const products = await handler(event('GET', '/products'))
assert.equal(products.statusCode, 200)
assert.deepEqual(JSON.parse(products.body), [product])
const simulation = await handler(event('POST', '/products/P001/simulate-price', { scenario_prices: [100] }))
assert.equal(simulation.statusCode, 200)
assert.equal(JSON.parse(simulation.body).scenarios[0].estimated_daily_revenue, 1000)
assert.equal(calls, 3)
console.log('Packaged Lambda entry point and production wiring passed with offline SDK transport')
