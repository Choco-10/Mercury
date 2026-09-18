import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'

// The supplied DocumentClient transport can be replaced in offline adapter tests.
// Analysis is stored with SK=ANALYSIS#<date> for idempotency (same-day cache).
// On repeated requests for the same product on the same day, the cached analysis
// is returned instead of recomputing.
export function createAnalysisWriter(client, tableName) {
  return async function putAnalysis(snapshot) {
    const date = snapshot.generated_at ? snapshot.generated_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
    await client.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PRODUCT#${snapshot.product_id}`,
        SK: `ANALYSIS#${date}`,
        data: snapshot,
        updated_at: new Date().toISOString(),
      },
      // Overwrite if exists (same-day update is allowed)
      // No condition expression - we want to update same-day analysis
    }))
  }
}

export function createAnalysisReader(client, tableName) {
  return async function getAnalysis(productId) {
    const today = new Date().toISOString().slice(0, 10)
    const response = await client.send(new GetCommand({
      TableName: tableName,
      Key: {
        PK: `PRODUCT#${productId}`,
        SK: `ANALYSIS#${today}`,
      },
    }))
    return response.Item ? response.Item.data : null
  }
}
