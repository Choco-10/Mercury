import test from 'node:test'
import assert from 'node:assert/strict'
import { QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'
import { createDynamoIO, IncompleteBatchWriteError } from '../src/services/dynamodb-io.js'

const table = 'offline-table'
const key = (n) => ({ PK: 'PRODUCT#P001', SK: `SALES#${n}` })
const items = (n) => Array.from({ length: n }, (_, i) => ({ PutRequest: { Item: key(i) } }))

function fixture(respond, options = {}) {
  const commands = []
  const waits = []
  const client = { send: async (command) => {
    commands.push(command)
    return respond(command, commands.length)
  } }
  return {
    ...createDynamoIO(client, table, {
      delay: async (ms) => { waits.push(ms) }, random: () => 0.5, ...options,
    }), commands, waits,
  }
}

test('query traverses empty intermediate pages and preserves keys and expressions', async () => {
  const input = {
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': 'PRODUCT#P001' }, ScanIndexForward: true,
  }
  const pages = [
    { Items: [{ data: 'a' }], LastEvaluatedKey: key(1) },
    { Items: [], LastEvaluatedKey: key(2) },
    { Items: [{ data: 'b' }], LastEvaluatedKey: {} },
  ]
  const { queryAll, commands } = fixture((command, count) => pages[count - 1])
  assert.deepEqual(await queryAll(input), [{ data: 'a' }, { data: 'b' }])
  assert.equal(commands.length, 3)
  for (const [i, command] of commands.entries()) {
    assert.ok(command instanceof QueryCommand)
    assert.deepEqual(command.input, {
      ...input, TableName: table, ...(i ? { ExclusiveStartKey: key(i) } : {}),
    })
  }
  assert.equal(Object.hasOwn(input, 'ExclusiveStartKey'), false)
})

test('empty query with no continuation returns an empty list', async () => {
  const { queryAll, commands } = fixture(() => ({}))
  assert.deepEqual(await queryAll({}), [])
  assert.equal(commands.length, 1)
})

test('page limit throws rather than returning partial results', async () => {
  const { queryAll, commands } = fixture((command, count) => ({
    Items: [{ data: count }], LastEvaluatedKey: key(count),
  }), { maxPages: 2 })
  await assert.rejects(queryAll({}), /partial results withheld/)
  assert.equal(commands.length, 2)
})

test('repeated pagination cursor fails promptly', async () => {
  const { queryAll, commands } = fixture(() => ({ LastEvaluatedKey: key(1) }))
  await assert.rejects(queryAll({}), /cursor repeated/)
  assert.equal(commands.length, 2)
})

test('query failure after a page propagates, without partial return', async () => {
  const failure = new Error('fake transport failure')
  const { queryAll } = fixture((command, count) => {
    if (count === 2) throw failure
    return { Items: [{ data: 'a' }], LastEvaluatedKey: key(1) }
  })
  await assert.rejects(queryAll({}), (err) => err === failure)
})

test('writes use 25-item chunks and empty input does not call transport', async () => {
  const { batchWrite, commands, waits } = fixture(() => ({}))
  await batchWrite([])
  assert.equal(commands.length, 0)
  const input = items(51)
  await batchWrite(input)
  assert.deepEqual(commands.map((c) => c.input.RequestItems[table].length), [25, 25, 1])
  assert.deepEqual(commands.flatMap((c) => c.input.RequestItems[table]), input)
  assert.ok(commands.every((c) => c instanceof BatchWriteCommand))
  assert.deepEqual(waits, [])
})

test('only unprocessed subset retried, next chunk waits until complete', async () => {
  const input = items(26)
  const { batchWrite, commands, waits } = fixture((command, count) => count === 1
    ? { UnprocessedItems: { [table]: [input[3], input[8]] } }
    : count === 2 ? { UnprocessedItems: { [table]: [input[8]] } } : {})
  const before = structuredClone(input)
  await batchWrite(input)
  assert.deepEqual(commands.map((c) => c.input.RequestItems[table]),
    [input.slice(0, 25), [input[3], input[8]], [input[8]], [input[25]]])
  assert.deepEqual(waits, [50, 100])
  assert.deepEqual(input, before)
})

test('default retry exhaustion is bounded and later chunks are not attempted', async () => {
  const { batchWrite, commands, waits } = fixture((c) => ({ UnprocessedItems: c.input.RequestItems }))
  await assert.rejects(batchWrite(items(26)), (err) => {
    assert.ok(err instanceof IncompleteBatchWriteError)
    assert.equal(err.remainingCount, 25)
    assert.equal(err.notAttemptedCount, 1)
    assert.equal(err.attempts, 6)
    return true
  })
  assert.equal(commands.length, 6)
  assert.deepEqual(waits, [50, 100, 200, 400, 800])
})

test('backoff ceiling is capped and success on final attempt is accepted', async () => {
  const { batchWrite, commands, waits } = fixture((c, count) => count < 4
    ? { UnprocessedItems: c.input.RequestItems } : {},
  { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 150 })
  await batchWrite(items(1))
  assert.equal(commands.length, 4)
  assert.deepEqual(waits, [50, 75, 75])
})

test('zero retries makes exactly one attempt without delay', async () => {
  const { batchWrite, commands, waits } = fixture((c) => ({ UnprocessedItems: c.input.RequestItems }),
    { maxRetries: 0 })
  await assert.rejects(batchWrite(items(1)), IncompleteBatchWriteError)
  assert.equal(commands.length, 1)
  assert.deepEqual(waits, [])
})

test('batch transport exceptions propagate without application-level retries', async () => {
  const failure = new Error('fake service failure')
  const { batchWrite, commands, waits } = fixture(() => { throw failure })
  await assert.rejects(batchWrite(items(26)), (err) => err === failure)
  assert.equal(commands.length, 1)
  assert.deepEqual(waits, [])
})

test('explicit empty unprocessed list completes', async () => {
  const { batchWrite, commands } = fixture(() => ({ UnprocessedItems: { [table]: [] } }))
  await batchWrite(items(1))
  assert.equal(commands.length, 1)
})

for (const options of [{ maxPages: 0 }, { maxRetries: -1 }, { maxRetries: 11 },
  { baseDelayMs: -1 }, { maxDelayMs: 50 }, { delay: null }]) {
  test(`invalid retry configuration rejected: ${JSON.stringify(options)}`, () => {
    assert.throws(() => fixture(() => ({}), options), /configuration/)
  })
}

test('missing table rejected before transport access', () => {
  assert.throws(() => createDynamoIO({ send: async () => {} }, ''), /table name/)
})
