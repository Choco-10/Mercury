/**
 * DynamoDB single-table adapter, injected with a DocumentClient transport.
 * Product: PK=SELLER#SELLER001, SK=PRODUCT#<id>
 * Sales: PK=PRODUCT#<id>, SK=SALES#<date>
 * Competitor: PK=PRODUCT#<id>, SK=COMPETITOR#<cid>#<date>
 * Analysis: PK=PRODUCT#<id>, SK=ANALYSIS#<date> (one snapshot per day)
 */
import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
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
      const row = normalizeStoredDate(data, 'date')
      const previous = byId.get(row.competitor_id)
      if (!previous || row.date > previous.date) {
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
        SK: `COMPETITOR#${row.competitor_id}#${row.date.slice(0, 10)}`,
        data: row,
      } },
    })))
  }

  // Batch-deletes every item in the product's partition, optionally narrowed by SK prefix.
  async function deleteRowsMatching(productId, prefix) {
    const items = await queryAll({
      KeyConditionExpression: prefix ? 'PK = :pk AND begins_with(SK, :prefix)' : 'PK = :pk',
      ExpressionAttributeValues: prefix
        ? { ':pk': `PRODUCT#${productId}`, ':prefix': prefix }
        : { ':pk': `PRODUCT#${productId}` },
      ProjectionExpression: 'PK, SK',
      ConsistentRead: true,
    })
    if (!items.length) return
    await batchWrite(items.map((item) => ({ DeleteRequest: { Key: { PK: item.PK, SK: item.SK } } })))
  }

  // Editing a product invalidates its same-day snapshots so the next read recomputes.
  async function deleteAnalysis(productId) {
    await deleteRowsMatching(productId, 'ANALYSIS#')
  }

  async function deleteProduct(productId) {
    // Cascade: every child row (sales, competitors, analyses) shares PK=PRODUCT#<id>.
    // Children are removed first so a mid-way failure leaves the product visible
    // with degraded data and the delete safe to retry. Not atomic.
    await deleteRowsMatching(productId)
    await client.send(new DeleteCommand({
      TableName: tableName,
      Key: { PK: 'SELLER#SELLER001', SK: `PRODUCT#${productId}` },
    }))
  }

  return {
    getProducts, getProduct, getSales, getCompetitorsLatest,
    putProduct, putSales, putCompetitors, deleteProduct, deleteAnalysis,
    putAnalysis: createAnalysisWriter(client, tableName),
    getAnalysis: createAnalysisReader(client, tableName),
  }
}
