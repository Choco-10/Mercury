/** Single HTTP API surface for every mode. Local dev points at the loopback
 * backend; AWS points at the deployed API Gateway. One implementation, no
 * browser-demo fallback, no duplicated analytics in the frontend.
 */
import { createHttpClient } from './http.js'

export const API_MODE = import.meta.env?.VITE_API_MODE || 'localhost'
export const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://127.0.0.1:3001'
const { get: httpGet, post: httpPost, put: httpPut, del: httpDelete } = createHttpClient({
  mode: API_MODE, baseUrl: API_BASE_URL,
})

export function uploadCsv(type, csv) {
  return httpPost('/data/upload', { type, csv })
}

/** POST /api/products — create a product. */
export function createProduct(product) {
  return httpPost('/products', product)
}

/** PUT /api/products/{id} — partial update; send only the fields you change. */
export function updateProduct(productId, patch) {
  return httpPut(`/products/${encodeURIComponent(productId)}`, patch)
}

/** DELETE /api/products/{id} — removes the product AND its sales/competitor/analysis rows. */
export function deleteProduct(productId) {
  return httpDelete(`/products/${encodeURIComponent(productId)}`)
}

// =====================================================================
// Public API — HTTP only.
// =====================================================================

/** GET /api/products */
export function fetchProducts() {
  return httpGet('/products')
}

/** GET /api/products/{id} */
export function fetchProduct(productId) {
  return httpGet(`/products/${encodeURIComponent(productId)}`)
}

/** GET /api/products/{id}/sales */
export function fetchSalesHistory(productId) {
  return httpGet(`/products/${encodeURIComponent(productId)}/sales`)
}

/** GET /api/products/{id}/competitors */
export function fetchCompetitors(productId) {
  return httpGet(`/products/${encodeURIComponent(productId)}/competitors`)
}

/**
 * GET /api/products/{id}/forecast — backend statistical baseline.
 * No SageMaker invocation is enabled by selecting an HTTP adapter.
 */
export function fetchForecast(productId) {
  return httpGet(`/products/${encodeURIComponent(productId)}/forecast`)
}

/**
 * POST /api/products/{id}/simulate-price
 *
 * The backend now derives the seven contract candidate prices from the current
 * product price and runs each through the SageMaker model (or the local endpoint
 * double offline). It returns the objective-optimal pick without Bedrock, in the
 * same shape as POST /pricing/recommend minus agent review:
 *   { product_id, current_price, inference_date, objective,
 *     recommended_price, predicted_units, predicted_revenue, reasoning,
 *     competitor_comparison, confidence, candidates, missing_data }
 *
 * Request body accepts an optional `objective` ("increase_sales" |
 * "maximize_revenue"); the backend defaults to "maximize_revenue". The previous
 * scenario_prices request field is no longer accepted by the route.
 */
export function simulatePrice(productId, objective = 'maximize_revenue') {
  return httpPost(
    `/products/${encodeURIComponent(productId)}/simulate-price`,
    { objective },
  )
}

/** GET /api/products/{id}/analysis — recommendation + metrics bundle */
export function fetchAnalysis(productId) {
  return httpGet(`/products/${encodeURIComponent(productId)}/analysis`)
}

/**
 * POST /api/ai/chat — multi-agent grounded analysis.
 * The backend always runs the real Bedrock runtime client in production
 * (Claude 3 Haiku, token-billed); the offline dev server injects its own
 * Bedrock double. All numbers come from deterministic analysis results,
 * never the LLM.
 */
export function askAnalyst(productId, question) {
  return httpPost('/ai/chat', { product_id: productId, question })
}