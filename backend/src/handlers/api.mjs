/**
 * Lambda API router — all /api/* routes.
 * Event: HTTP API Gateway v2 (HTTP API) proxy event.
 * rawPath is /<stage>/<api-path>, e.g. /prod/api/products -> path /products
 */
import { createAnalysisSnapshot, computeAnalysis, AnalysisDataError } from '../services/analysis-run.js'
import { forecastResponse, pricingResponse, ProductDataError } from '../services/product-results.js'
import { CsvError } from '../ingestion/csv-records.js'
import { createIngestion } from '../ingestion/pipeline.js'
import { UPLOAD_ID_PATTERN } from '../services/upload-ledger.js'
import { handleAIChat } from './ai.mjs'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
}

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) }
}

let productionHandler

export async function handler(event) {
  try {
    if (!productionHandler) {
      productionHandler = import('../services/store.js')
        .then((store) => createHandler(store, { objectStore: store.objectStore, ledger: store.ledger }))
    }
    return await (await productionHandler)(event)
  } catch (err) {
    console.error(err)
    return json(500, { error: 'Internal server error' })
  }
}

// No default store: tests must explicitly supply every storage dependency.
export function createHandler(store, { objectStore, ledger, forecastOptions } = {}) {
  const required = [
    'getProducts', 'getProduct', 'getSales',
    'getCompetitorsLatest', 'putSales', 'putCompetitors', 'putAnalysis', 'getAnalysis',
  ]
  for (const name of required) {
    if (typeof store?.[name] !== 'function') {
      throw new TypeError(`Missing storage dependency: ${name}`)
    }
  }

  const {
    getProducts, getProduct, getSales,
    getCompetitorsLatest, putAnalysis, getAnalysis,
  } = store

  return async function route(event) {
    const method = event.requestContext.http.method
    // Handle events with or without the named stage in rawPath.
    const stage = event.requestContext.stage
    let rawPath = event.rawPath || ''

    if (stage && stage !== '$default') {
      const prefix = `/${stage}`
      if (rawPath === prefix || rawPath.startsWith(`${prefix}/`)) {
        rawPath = rawPath.slice(prefix.length)
      }
    }

    const path = rawPath
      .replace(/^\/api(?=\/|$)/, '')
      .replace(/\/$/, '')

    const id = event.pathParameters?.id

    try {
      // ---- products ----
      if (method === 'GET' && path === '/products') return json(200, await getProducts())

      const productPath = id ? `/products/${id}` : null
      const supportedGetPaths = productPath ? [
        productPath,
        `${productPath}/sales`,
        `${productPath}/competitors`,
        `${productPath}/forecast`,
        `${productPath}/analysis`,
      ] : []

      if (method === 'GET' && supportedGetPaths.includes(path)) {
        const sub = path.split('/').pop()
        const product = await getProduct(id)
        if (!product) return json(404, { error: `Product ${id} not found` })

        const baseMatch = path === productPath
        if (baseMatch) return json(200, product)

        if (sub === 'sales') return json(200, await getSales(id))
        if (sub === 'competitors') return json(200, await getCompetitorsLatest(id))
        const sales = await getSales(id)
        if (sub === 'forecast') return json(200, await forecastResponse(id, sales, forecastOptions))
        const comps = await getCompetitorsLatest(id)
        if (sub === 'analysis') {
          // Same guarded computation as POST /analyze; no snapshot is saved or read.
          try {
            return json(200, await computeAnalysis(product, sales, comps, forecastOptions))
          } catch (err) {
            if (err instanceof AnalysisDataError) {
              return json(422, { error: err.message, issues: err.issues })
            }
            throw err
          }
        }
      }

      // POST computes and persists; GET /analysis remains read-only.
      if (method === 'POST' && productPath && path === `${productPath}/analyze`) {
        let body
        try {
          const text = event.isBase64Encoded
            ? Buffer.from(event.body || '', 'base64').toString('utf8')
            : event.body || ''
          body = JSON.parse(text === '' ? '{}' : text)
        } catch {
          return json(400, { error: 'Request body must contain valid JSON' })
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
          return json(400, { error: 'Analyze accepts no body or an empty JSON object' })
        }

        const product = await getProduct(id)
        if (!product) return json(404, { error: `Product ${id} not found` })
        // On-demand analysis with same-day idempotency: repeated requests on the
        // same day return the stored snapshot instead of recomputing.
        let existing
        try {
          existing = await getAnalysis(id)
        } catch (err) {
          console.error(err)
          return json(500, { error: 'Internal server error' })
        }
        if (existing) return json(200, existing)
        const sales = await getSales(id)
        const competitors = await getCompetitorsLatest(id)
        let snapshot
        try {
          snapshot = await createAnalysisSnapshot(product, sales, competitors, forecastOptions)
        } catch (err) {
          if (err instanceof AnalysisDataError) {
            return json(422, { error: err.message, issues: err.issues })
          }
          throw err
        }
        await putAnalysis(snapshot)
        return json(200, snapshot)
      }

      // ---- pricing simulation (read-only decision support) ----
      if (method === 'POST' && productPath && path === `${productPath}/simulate-price`) {
        let body
        try {
          const text = event.isBase64Encoded
            ? Buffer.from(event.body || '', 'base64').toString('utf8')
            : event.body || ''
          body = JSON.parse(text)
        } catch {
          return json(400, { error: 'Request body must contain valid JSON' })
        }

        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return json(400, { error: 'Request body must be a JSON object' })
        }

        const prices = body.scenario_prices
        if (
          !Array.isArray(prices) || prices.length === 0 || prices.length > 25 ||
          prices.some((price) => !Number.isFinite(price) || price <= 0)
        ) {
          return json(400, {
            error: 'scenario_prices must be a nonempty array of at most 25 finite positive numbers',
          })
        }

        const product = await getProduct(id)
        if (!product) return json(404, { error: `Product ${id} not found` })
        const sales = await getSales(id)
        try {
          return json(200, pricingResponse(product, sales, prices))
        } catch (err) {
          if (err instanceof ProductDataError) {
            return json(err.statusCode, { error: err.message })
          }
          throw err
        }
      }

    // ---- AI chat (Bedrock multi-agent) ----
    if (method === 'POST' && path === '/ai/chat') {
      return handleAIChat(event, store);
    }

    // Exact, bounded lookup only; no public list of uploads or artifact download URLs.
    const uploadMatch = /^\/data\/uploads\/([^/]+)$/.exec(path)
    if (method === 'GET' && uploadMatch) {
      if (!UPLOAD_ID_PATTERN.test(uploadMatch[1])) return json(400, { error: 'Invalid upload ID' })
      if (typeof ledger?.getUpload !== 'function') throw new Error('Upload ledger is not configured')
      const outcome = await ledger.getUpload(uploadMatch[1])
      return outcome ? json(200, outcome) : json(404, { error: 'Upload not found' })
    }

    // ---- data upload ----
    if (method === 'POST' && path === '/data/upload') {
      if (typeof event.body === 'string' && Buffer.byteLength(event.body, 'utf8') > 2 * 1024 * 1024) {
        return json(413, { error: 'Upload request exceeds 2 MiB limit' })
      }
      let body
      try {
        const text = event.isBase64Encoded
          ? Buffer.from(event.body || '', 'base64').toString('utf8')
          : event.body || ''
        body = JSON.parse(text === '' ? '{}' : text)
      } catch {
        return json(400, { error: 'Request body must contain valid JSON' })
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(400, { error: 'Request body must be a JSON object' })
      }
      const { type, csv } = body
      if (type !== 'sales' && type !== 'competitors') {
        return json(400, { error: 'type must be "sales" or "competitors"' })
      }
      if (typeof csv !== 'string' || !csv.trim()) return json(400, { error: 'csv must be a nonempty string' })
      try {
        const result = await createIngestion({ objectStore, ledger, forecastOptions })(store, type, csv)
        return json(result.statusCode, result.body)
      } catch (err) {
        if (err instanceof CsvError) return json(err.statusCode, { error: err.message, issues: err.issues })
        throw err
      }
    }

    return json(404, { error: `No route for ${method} ${path}` })
  } catch (err) {
    console.error(err)
    return json(500, { error: 'Internal server error' })
  }
  }
}

