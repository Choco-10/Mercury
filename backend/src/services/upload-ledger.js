/** One writer per generated upload ID. No automatic resume or request deduplication. */
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'

export const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function createLedger(client, tableName) {
  if (typeof client?.send !== 'function') throw new TypeError('A DocumentClient transport is required')
  if (typeof tableName !== 'string' || !tableName.trim()) throw new TypeError('A table name is required')
  function key(id) {
    if (!UPLOAD_ID_PATTERN.test(id)) throw new TypeError('Invalid upload ID')
    return { PK: 'SELLER#SELLER001', SK: `UPLOAD#${id}` }
  }
  async function putRecordOutcome(record, { create = false } = {}) {
    await client.send(new PutCommand({
      TableName: tableName,
      Item: { ...key(record.upload_id), data: structuredClone(record) },
      ConditionExpression: create
        ? 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        : 'attribute_exists(PK) AND attribute_exists(SK)',
    }))
  }
  async function getUpload(id) {
    const response = await client.send(new GetCommand({
      TableName: tableName, Key: key(id), ConsistentRead: true,
    }))
    return response.Item?.data ?? null
  }
  return { putRecordOutcome, getUpload }
}
