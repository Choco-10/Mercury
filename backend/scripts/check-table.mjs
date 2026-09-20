/**
 * No demo seeding. The deployed catalog starts empty, exactly like local boot:
 * the seller creates every product in the UI (POST /api/products) and uploads
 * every observation (POST /api/data/upload). This script only verifies the
 * table is reachable and reports the current product count.
 * Requires an explicit TABLE_NAME and AWS credentials. Never run in offline tests.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { createStore } from '../src/services/store-adapter.js'

async function main() {
  const table = process.env.TABLE_NAME
  if (!table?.trim()) throw new Error('Set TABLE_NAME explicitly before seeding')
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: process.env.AWS_REGION || 'ap-south-1', maxAttempts: 3,
  }))
  const store = createStore(client, table)
  const products = await store.getProducts()
  console.log(`Table ${table} reachable. Products in catalog: ${products.length}`)
  console.log('Catalog starts empty by design — add products in the UI, then upload CSVs.')
}

main().catch((err) => { console.error(err); process.exitCode = 1 })

