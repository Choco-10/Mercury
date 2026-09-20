/**
 * Lambda API router — all /api/* routes.
 * Event: HTTP API Gateway v2 (HTTP API) proxy event.
 * rawPath is /<stage>/<api-path>, e.g. /prod/api/products -> path /products
 */
import { createAnalysisSnapshot, computeAnalysis, AnalysisDataError } from '../services/analysis-run.js'
import { forecastResponse, ProductDataError } from '../services/product-results.js'
import { CsvError } from '../ingestion/csv-records.js'
import { createIngestion } from '../ingestion/pipeline.js'
import { UPLOAD_ID_PATTERN } from '../services/upload-ledger.js'
import { OBJECTIVES as CONTRACT_OBJECTIVES } from '../services/pricing/contract.js'
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
      productionHandler = Promise.all([
        import('../services/store.js'),
        buildProductionPricing(),
      ]).then(([store, pricing]) => createHandler(store,
        { objectStore: store.objectStore, ledger: store.ledger, pricing }))
    }
    return await (await productionHandler)(event)
  } catch (err) {
    console.error(err)
    return json(500, { error: 'Internal server error' })
  }
}

// Production-only wiring (never imported by backend/local/*): real S3 mappings,
// the serverless SageMaker endpoint, and the real Bedrock runtime client.
async function buildProductionPricing() {
  const [{ S3Client }, { SageMakerRuntimeClient }, { createBedrockClient },
    { createPricingWorkflow }, { createPricingArtifacts, createEndpointInvoker }] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/client-sagemaker-runtime'),
    import('../services/bedrock-client.js'),
    import('../services/pricing/workflow.js'),
    import('../services/pricing/aws-clients.js'),
  ])
  const pricingBucket = process.env.S3_BUCKET || 'pricing-ai-780891107631'
  const s3 = new S3Client({ maxAttempts: 3 })
  const artifacts = createPricingArtifacts(s3, pricingBucket)
  const endpointName = process.env.SAGEMAKER_ENDPOINT_NAME || 'pricing-xgboost-endpoint'
  const runtime = new SageMakerRuntimeClient({ maxAttempts: 3 })
  const { getProduct, getSales, getCompetitorsLatest } =
    await import('../services/store.js')
  return createPricingWorkflow({
    store: { getProduct, getSales, getCompetitorsLatest },
    artifacts,
    invokeEndpoint: createEndpointInvoker(runtime, endpointName),
    bedrock: createBedrockClient(),
  })
}

// No default store: tests must explicitly supply every storage dependency.
export function createHandler(store, { objectStore, ledger, forecastOptions, pricing } = {}) {
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

  

  async function handlePricingRecommend(event) {
    if (!pricing || typeof pricing.recommend !== 'function') {
      return json(501, { error: 'Pricing recommendations are not configured for this deployment' })
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
    try {
      const result = await pricing.recommend({
        product_id: body.product_id,
        objective: body.objective,
      })
      return json(200, result)
    } catch (err) {
      if (err && typeof err.statusCode === 'number') {
        const details = { error: err.message }
        if (err.code) details.code = err.code
        if (err.issues) details.issues = err.issues
        return json(err.statusCode, details)
      }
      if (err?.name === 'PricingError' && typeof err.code === 'string') {
        const status = err.code === 'unsupported_product' || err.code === 'invalid_input' ? 400
          : err.code === 'no_seller_history' ? 422 : 502
        return json(status, { error: err.message, code: err.code })
      }
      throw err
    }
  }

  async function handleSimulatePrice(event, productId) {
    if (!pricing || typeof pricing.simulate !== 'function') {
      return json(501, { error: 'Price simulation is not configured for this deployment' })
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
    if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.objective === 'string') {
      if (!CONTRACT_OBJECTIVES.includes(body.objective)) {
        return json(400, { error: `objective must be one of ${CONTRACT_OBJECTIVES.join(' | ')}` })
      }
    }
    try {
      const result = await pricing.simulate(productId, body?.objective ?? 'maximize_revenue')
      return json(200, result)
    } catch (err) {
      if (err && typeof err.statusCode === 'number') {
        const details = { error: err.message }
        if (err.code) details.code = err.code
        if (err.issues) details.issues = err.issues
        return json(err.statusCode, details)
      }
      if (err?.name === 'PricingError' && typeof err.code === 'string') {
        const status = err.code === 'unsupported_product' || err.code === 'invalid_input' ? 400
          : err.code === 'no_seller_history' || err.code === 'invalid_history' || err.code === 'insufficient_history' ? 422
          : err.code === 'aws_not_configured' ? 503
          : 502
        return json(status, { error: err.message, code: err.code })
      }
      throw err
    }
  }


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

      // ---- create product ----
      if (method === 'POST' && path === '/products') {
        if (typeof store.putProduct !== 'function') return json(501, { error: 'Product creation is not supported by this storage adapter' })
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
        const { product_id, title, category, subcategory, price, discount, rating, inventory } = body
        if (typeof product_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(product_id)) {
          return json(400, { error: 'product_id is required: 1-64 letters, digits, underscore or hyphen' })
        }
        if (typeof title !== 'string' || !title.trim() || title.length > 200) {
          return json(400, { error: 'title is required (1-200 characters)' })
        }
        if (typeof category !== 'string' || !category.trim() || category.length > 100) {
          return json(400, { error: 'category is required (1-100 characters)' })
        }
        const numeric = (value) => typeof value === 'number' && Number.isFinite(value)
        if (!numeric(price) || price <= 0) return json(400, { error: 'price must be a positive finite number' })
        if (discount !== undefined && (!numeric(discount) || discount < 0 || discount > 100)) {
          return json(400, { error: 'discount must be a number between 0 and 100' })
        }
        if (rating !== undefined && (!numeric(rating) || rating < 0 || rating > 5)) {
          return json(400, { error: 'rating must be a number between 0 and 5' })
        }
        if (inventory !== undefined && (!Number.isInteger(inventory) || inventory < 0)) {
          return json(400, { error: 'inventory must be a nonnegative integer' })
        }
        if (await getProduct(product_id)) return json(409, { error: `Product ${product_id} already exists` })
        const product = {
          product_id,
          title: title.trim(),
          category: category.trim(),
          ...(typeof subcategory === 'string' && subcategory.trim() ? { subcategory: subcategory.trim() } : {}),
          price,
          discount: discount ?? 0,
          rating: rating ?? 0,
          inventory: inventory ?? 0,
          created_at: new Date().toISOString(),
        }
        await store.putProduct(product)
        return json(201, product)
      }

      const productPath = id ? `/products/${id}` : null

      // ---- update product (partial merge; product_id is immutable) ----
      if (method === 'PUT' && productPath && path === productPath) {
        if (typeof store.putProduct !== 'function') {
          return json(501, { error: 'Product update is not supported by this storage adapter' })
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
        const UPDATE_FIELDS = ['product_id', 'title', 'category', 'subcategory', 'price', 'discount', 'rating', 'inventory']
        const unexpected = Object.keys(body).filter((key) => !UPDATE_FIELDS.includes(key))
        if (unexpected.length) {
          return json(400, { error: `Unexpected fields: ${unexpected.join(', ')}` })
        }
        // The id is the storage key; renaming would orphan every child row.
        if (body.product_id !== undefined && body.product_id !== id) {
          return json(400, { error: 'product_id cannot be changed' })
        }
        const existing = await getProduct(id)
        if (!existing) return json(404, { error: `Product ${id} not found` })

        const numeric = (value) => typeof value === 'number' && Number.isFinite(value)
        const patch = {}
        if (body.title !== undefined) {
          if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) {
            return json(400, { error: 'title must be 1-200 characters' })
          }
          patch.title = body.title.trim()
        }
        if (body.category !== undefined) {
          if (typeof body.category !== 'string' || !body.category.trim() || body.category.length > 100) {
            return json(400, { error: 'category must be 1-100 characters' })
          }
          patch.category = body.category.trim()
        }
        if (body.subcategory !== undefined && typeof body.subcategory !== 'string') {
          return json(400, { error: 'subcategory must be a string' })
        }
        if (typeof body.subcategory === 'string') patch.subcategory = body.subcategory.trim()
        if (body.price !== undefined) {
          if (!numeric(body.price) || body.price <= 0) {
            return json(400, { error: 'price must be a positive finite number' })
          }
          patch.price = body.price
        }
        if (body.discount !== undefined) {
          if (!numeric(body.discount) || body.discount < 0 || body.discount > 100) {
            return json(400, { error: 'discount must be a number between 0 and 100' })
          }
          patch.discount = body.discount
        }
        if (body.rating !== undefined) {
          if (!numeric(body.rating) || body.rating < 0 || body.rating > 5) {
            return json(400, { error: 'rating must be a number between 0 and 5' })
          }
          patch.rating = body.rating
        }
        if (body.inventory !== undefined) {
          if (!Number.isInteger(body.inventory) || body.inventory < 0) {
            return json(400, { error: 'inventory must be a nonnegative integer' })
          }
          patch.inventory = body.inventory
        }
        const updated = { ...existing, ...patch, product_id: id, updated_at: new Date().toISOString() }
        // An explicitly blank subcategory clears the field.
        if (updated.subcategory === '') delete updated.subcategory
        await store.putProduct(updated)
        // The same-day snapshot was computed from the previous values; drop it so
        // the next analysis read recomputes instead of serving stale numbers.
        if (typeof store.deleteAnalysis === 'function') await store.deleteAnalysis(id)
        return json(200, updated)
      }

      // ---- delete product (cascades sales, competitors and analyses) ----
      if (method === 'DELETE' && productPath && path === productPath) {
        if (typeof store.deleteProduct !== 'function') {
          return json(501, { error: 'Product deletion is not supported by this storage adapter' })
        }
        if (!(await getProduct(id))) return json(404, { error: `Product ${id} not found` })
        await store.deleteProduct(id)
        return json(200, { deleted: true, product_id: id })
      }

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

      // ---- pricing recommendation (SageMaker XGBoost + Bedrock agents) ----
      if (method === 'POST' && path === '/pricing/recommend') {
        return handlePricingRecommend(event)
      }

      if (method === 'POST' && productPath && path === `${productPath}/simulate-price`) {
        return handleSimulatePrice(event, id)
      }

      // ---- AI chat (Bedrock multi-agent) ----
      if (method === 'POST' && path === '/ai/chat') {
        return handleAIChat(event, store)
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