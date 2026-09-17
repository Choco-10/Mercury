import { createServer } from 'node:http'
import { createHandler } from '../src/handlers/api.mjs'
import { createMemoryStore } from './memory-store.mjs'
import { createMemoryUploadStorage } from '../src/services/memory-upload-storage.js'

const ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_BODY_BYTES = 2 * 1024 * 1024

// No production handler import/call, environment-selected adapters, or cloud fallback.
export function createLocalServer(dataset) {
  const store = createMemoryStore(dataset)
  const storage = createMemoryUploadStorage()
  const route = createHandler(store, storage)
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    const cors = origin && ORIGINS.has(origin) ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    } : {}
    function reply(status, body) {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', ...cors })
      res.end(body)
    }
    function error(status, message) {
      req.resume()
      reply(status, JSON.stringify({ error: message }))
    }
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`
      if (![expectedHost, `localhost:${server.address().port}`].includes(req.headers.host)) {
        return error(403, 'Only a loopback Host is allowed')
      }
      if (origin && !ORIGINS.has(origin)) return error(403, 'Development origin is not allowed')
      if (!req.url.startsWith('/api/') || req.url.includes('#')) return error(404, 'No local API route')
      if (req.method === 'OPTIONS') return reply(204, '')
      if (!['GET', 'POST'].includes(req.method)) return error(404, 'No local API route')
      if (req.method === 'POST' && req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return error(415, 'Use Content-Type: application/json')
      }
      if (Number(req.headers['content-length']) > MAX_BODY_BYTES) return error(413, 'Request exceeds 2 MiB limit')
      const chunks = []
      let bytes = 0
      const body = await new Promise((resolve, reject) => {
        req.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes > MAX_BODY_BYTES) {
            if (!res.writableEnded) error(413, 'Request exceeds 2 MiB limit')
            chunks.length = 0
            resolve(null)
          } else if (!res.writableEnded) chunks.push(chunk)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
        req.on('aborted', () => reject(new Error('Request aborted')))
      })
      if (body === null || res.writableEnded) return
      const [rawPath, rawQueryString = ''] = req.url.split('?')
      const product = /^\/api\/products\/([^/]+)(?:\/([^/]+))?\/?$/.exec(rawPath)
      const result = await route({
        version: '2.0', rawPath, rawQueryString,
        requestContext: { stage: '$default', http: { method: req.method } },
        headers: req.headers, body, isBase64Encoded: false,
        pathParameters: product ? { id: product[1], ...(product[2] ? { sub: product[2] } : {}) } : undefined,
      })
      // Deliberately replace the Lambda's wildcard CORS with restricted local CORS.
      reply(result.statusCode, result.body)
    } catch (err) {
      console.error('Local API request failed', err)
      if (!res.headersSent && !res.destroyed) error(500, 'Internal server error')
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  return {
    // Always loopback, including tests; callers cannot supply a public interface.
    listen: (port = 3001) => new Promise((resolve, reject) => {
      if (!Number.isInteger(port) || port < 0 || port > 65535) return reject(new TypeError('Invalid port'))
      const failed = (err) => reject(err)
      server.once('error', failed)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', failed)
        resolve(`http://127.0.0.1:${server.address().port}`)
      })
    }),
    close: () => new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve())
      server.closeAllConnections()
    }),
  }
}
