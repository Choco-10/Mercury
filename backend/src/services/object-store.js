/**
 * S3 object storage for raw and normalized upload artifacts.
 * Transport-injected so offline tests never contact AWS.
 */
import { PutObjectCommand } from '@aws-sdk/client-s3'

export function createS3ObjectStore(client, bucketName) {
  if (typeof client?.send !== 'function') throw new TypeError('An S3 client transport is required')
  if (typeof bucketName !== 'string' || !bucketName.trim()) throw new TypeError('A bucket name is required')

  return async function putObject(key, body, contentType) {
    if (typeof key !== 'string' || !key || key.startsWith('/') || key.includes('..') || key.includes('\\')) {
      throw new TypeError('Object keys must be relative and cannot traverse paths')
    }
    if (typeof body !== 'string' || !['text/csv; charset=utf-8', 'application/json'].includes(contentType)) {
      throw new TypeError('Artifact body must be text with an explicit CSV or JSON content type')
    }
    const response = await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    }))
    return { key, etag: response.ETag ?? null }
  }
}
