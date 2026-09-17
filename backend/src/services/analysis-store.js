import { PutCommand } from '@aws-sdk/lib-dynamodb'

// The supplied DocumentClient transport can be replaced in offline adapter tests.
export function createAnalysisWriter(client, tableName) {
  return async function putAnalysis(snapshot) {
    await client.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PRODUCT#${snapshot.product_id}`,
        SK: `ANALYSIS#${snapshot.generated_at}#${snapshot.analysis_id}`,
        data: snapshot,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    }))
  }
}
