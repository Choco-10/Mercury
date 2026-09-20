import { GetObjectCommand } from '@aws-sdk/client-s3'
import { InvokeEndpointCommand } from '@aws-sdk/client-sagemaker-runtime'

/**
 * Read-only S3 adapter for model mappings + seller uploads (ai.md §5/§16).
 * `client` is the @aws-sdk/client-s3 S3Client; `bucket` is the pricing bucket.
 */
export function createPricingArtifacts(client, bucket) {
  if (typeof client?.send !== 'function') throw new TypeError('An S3 client transport is required')
  if (typeof bucket !== 'string' || !bucket.trim()) throw new TypeError('A pricing bucket name is required')
  async function readText(key) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!response?.Body) throw new Error(`s3://${bucket}/${key} returned an empty body`)
    if (typeof response.Body.transformToString === 'function') {
      return response.Body.transformToString('utf-8')
    }
    const chunks = []
    for await (const chunk of response.Body) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8')
  }
  async function readJson(key) {
    return JSON.parse(await readText(key))
  }
  async function writeJson(key, value) {
    const { createS3ObjectStore } = await import('../object-store.js')
    const putObject = createS3ObjectStore(client, bucket)
    await putObject(key, JSON.stringify(value, null, 2), 'application/json')
    return { key }
  }
  return { readText, readJson, writeJson }
}

/**
 * One InvokeEndpoint call per candidate price (ai.md §13/§18).
 * Returns async (csvPayload) => predicted units; sequential calls stay at the
 * serverless endpoint's MaxConcurrency 1.
 */
export function createEndpointInvoker(client, endpointName) {
  if (typeof client?.send !== 'function') throw new TypeError('A SageMaker runtime client transport is required')
  if (typeof endpointName !== 'string' || !endpointName.trim()) {
    throw new TypeError('A SageMaker endpoint name is required')
  }
  return async function invokeEndpoint(payload) {
    const response = await client.send(new InvokeEndpointCommand({
      EndpointName: endpointName,
      ContentType: 'text/csv',
      Body: payload,
    }))
    const body = response?.Body
    const text = typeof body?.transformToString === 'function'
      ? await body.transformToString('utf-8')
      : Buffer.from(body ?? '').toString('utf8')
    const units = Number(String(text).trim())
    if (!Number.isFinite(units)) {
      throw new Error(`endpoint ${endpointName} returned a non-numeric prediction`)
    }
    return units
  }
}
