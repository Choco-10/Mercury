/**
 * Manual cloud seeding only. Requires an explicit TABLE_NAME and AWS credentials.
 * This writes to DynamoDB and can consume AWS credits. Never run in offline tests.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { createStore } from '../src/services/store-adapter.js'
import { getDemoDataset } from '../../frontend/src/data/demoData.js'

async function main() {
  const table = process.env.TABLE_NAME
  if (!table?.trim()) throw new Error('Set TABLE_NAME explicitly before seeding')
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: process.env.AWS_REGION || 'ap-south-1', maxAttempts: 3,
  }))
  const store = createStore(client, table)
  const ds = getDemoDataset()
  console.log(`Seeding ${ds.products.length} products, ${ds.days} days of history…`)
  for (const product of ds.products) await store.putProduct(product)
  console.log('✓ products')
  for (const product of ds.products) {
    const id = product.product_id
    await store.putSales(id, ds.sales_history[id])
    await store.putCompetitors(id, ds.competitors[id])
    console.log(`✓ ${id} — ${ds.sales_history[id].length} sales rows, ${ds.competitors[id].length} competitor observations`)
  }
  console.log('Seed complete.')
}

main().catch((err) => { console.error(err); process.exitCode = 1 })

