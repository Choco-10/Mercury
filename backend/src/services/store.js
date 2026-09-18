/** Production wiring only. Offline tests import store-adapter.js, not this module. */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { createStore } from './store-adapter.js'
import { S3Client } from '@aws-sdk/client-s3'
import { createS3ObjectStore } from './object-store.js'
import { createLedger } from './upload-ledger.js'

// SDK retries handle retryable service exceptions. UnprocessedItems are handled
// separately by the adapter, with bounded retries of only the pending subset.
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }))

export const {
  getProducts, getProduct, getSales, getCompetitorsLatest,
  putProduct, putSales, putCompetitors, putAnalysis, getAnalysis,
} = createStore(doc, process.env.TABLE_NAME)

export const objectStore = createS3ObjectStore(new S3Client({ maxAttempts: 3 }), process.env.BUCKET_NAME)
export const ledger = createLedger(doc, process.env.TABLE_NAME)

