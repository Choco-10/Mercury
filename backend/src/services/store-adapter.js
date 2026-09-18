/**
 * DynamoDB single-table adapter, injected with a DocumentClient transport.
 * Product: PK=SELLER#SELLER001, SK=PRODUCT#<id>
 * Sales: PK=PRODUCT#<id>, SK=SALES#<date>
 * Competitor: PK=PRODUCT#<id>, SK=COMPETITOR#<cid>#<date>
 * Analysis: PK=PRODUCT#<id>, SK=ANALYSIS#<date> (one snapshot per day)
 */
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { createAnalysisWriter, createAnalysisReader } from './analysis-store.js'
import { createDynamoIO } from './dynamodb-io.js'
import { normalizeStoredDate } from './stored-date.js'


export function createStore(client, tableName, options = {}) {
  const { queryAll, batchWrite } = createDynamoIO(client, tableName, options)

  async function getProducts() {
    const items = await queryAll({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': 'SELLER#SELLER001', ':prefix': 'PRODUCT#' },
    })
    return items.map((item) => item.data)
  }

  async function getProduct(productId) {
    const response = await client.send(new GetCommand({
      TableName: tableName,
      Key: { PK: 'SELLER#SELLER001', SK: `PRODUCT#${productId}` },
    }))
    return response.Item ? response.Item.data : null
  }

  async function getSales(productId) {
    const items = await queryAll({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `PRODUCT#${productId}`, ':prefix': 'SALES#' },
      ScanIndexForward: true,
      ConsistentRead: true,
    })
    return items.map((item) => normalizeStoredDate(item.data, 'date')).sort((a, b) => a.date.localeCompare(b.date))
  }

  async function getCompetitorsLatest(productId) {
    const items = await queryAll({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `PRODUCT#${productId}`, ':prefix': 'COMPETITOR#' },
      ScanIndexForward: true,
      ConsistentRead: true,
    })
    const byId = new Map()
    for (const { data } of items) {
      const row = normalizeStoredDate(data, 'observation_date')
      const previous = byId.get(row.competitor_id)
      if (!previous || row.observation_date > previous.observation_date) {
        byId.set(row.competitor_id, row)
      }
    }
    return [...byId.values()]
  }

  async function putProduct(product) {
    await client.send(new PutCommand({
      TableName: tableName,
      Item: { PK: 'SELLER#SELLER001', SK: `PRODUCT#${product.product_id}`, data: product },
    }))
  }

  async function putSales(productId, rows) {
    await batchWrite(rows.map((row) => ({
      PutRequest: { Item: {
        PK: `PRODUCT#${productId}`, SK: `SALES#${row.date.slice(0, 10)}`, data: row,
      } },
    })))
  }

  async function putCompetitors(productId, rows) {
    await batchWrite(rows.map((row) => ({
      PutRequest: { Item: {
        PK: `PRODUCT#${productId}`,
        SK: `COMPETITOR#${row.competitor_id}#${row.observation_date.slice(0, 10)}`,
        data: row,
      } },
    })))
  }

  return {
    getProducts, getProduct, getSales, getCompetitorsLatest,
    putProduct, putSales, putCompetitors,
    putAnalysis: createAnalysisWriter(client, tableName),
    getAnalysis: createAnalysisReader(client, tableName),
  }
}
