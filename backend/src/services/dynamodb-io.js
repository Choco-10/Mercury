import { QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'
import { setTimeout as sleep } from 'node:timers/promises'

export class IncompleteBatchWriteError extends Error {
  constructor(remainingCount, notAttemptedCount, attempts) {
    super(`Batch write incomplete after ${attempts} attempts: ${remainingCount} unprocessed, ${notAttemptedCount} not attempted`)
    this.name = 'IncompleteBatchWriteError'
    this.remainingCount = remainingCount
    this.notAttemptedCount = notAttemptedCount
    this.attempts = attempts
  }
}

export function createDynamoIO(client, tableName, {
  maxPages = 1000,
  maxRetries = 5,
  baseDelayMs = 100,
  maxDelayMs = 2000,
  delay = sleep,
  random = Math.random,
} = {}) {
  if (typeof client?.send !== 'function') throw new TypeError('A DocumentClient transport is required')
  if (typeof tableName !== 'string' || !tableName.trim()) throw new TypeError('A table name is required')
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 ||
      !Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10 ||
      !Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0 ||
      !Number.isSafeInteger(maxDelayMs) || maxDelayMs < baseDelayMs ||
      typeof delay !== 'function' || typeof random !== 'function') {
    throw new TypeError('Invalid pagination or retry configuration')
  }

  async function queryAll(input) {
    const items = []
    let cursor
    const seen = new Set()
    for (let page = 0; page < maxPages; page++) {
      const response = await client.send(new QueryCommand({
        ...input, TableName: tableName,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }))
      items.push(...(response.Items || []))
      const next = response.LastEvaluatedKey
      if (!next || Object.keys(next).length === 0) return items
      const signature = JSON.stringify(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
      if (seen.has(signature)) throw new Error('DynamoDB pagination cursor repeated')
      seen.add(signature)
      cursor = next
    }
    throw new Error(`DynamoDB query exceeded ${maxPages} pages; partial results withheld`)
  }

  async function batchWrite(items) {
    for (let offset = 0; offset < items.length; offset += 25) {
      let pending = items.slice(offset, offset + 25)
      for (let attempt = 0; ; attempt++) {
        // SDK exceptions propagate. Only explicit UnprocessedItems are retried here.
        const response = await client.send(new BatchWriteCommand({
          RequestItems: { [tableName]: pending },
        }))
        pending = response.UnprocessedItems?.[tableName] || []
        if (pending.length === 0) break
        if (attempt >= maxRetries) {
          throw new IncompleteBatchWriteError(
            pending.length, Math.max(0, items.length - offset - 25), attempt + 1,
          )
        }
        const jitter = random()
        if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1) {
          throw new TypeError('Retry random source must return a number in [0, 1)')
        }
        const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
        await delay(Math.floor(jitter * ceiling))
      }
    }
  }

  return { queryAll, batchWrite }
}
