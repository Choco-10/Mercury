export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export function createHttpClient({ mode, baseUrl = '', fetchImpl = globalThis.fetch }) {
  if (!['localhost', 'aws'].includes(mode)) throw new Error('Unknown VITE_API_MODE (expected localhost or aws)')
  const url = new URL(baseUrl || (mode === 'localhost' ? 'http://127.0.0.1:3001' : ''))
  if (url.username || url.password || url.search || url.hash) throw new Error('API base must not contain credentials, query or fragment')
  if (mode === 'localhost' && (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/')) {
    throw new Error('localhost mode requires an HTTP loopback origin without a path')
  }
  if (mode === 'aws' && url.protocol !== 'https:') throw new Error('AWS mode requires HTTPS')
  if (/\/api\/?$/.test(url.pathname)) throw new Error('API base must not end with /api; the client adds it')
  const base = url.href.replace(/\/$/, '')
  async function request(method, path, body) {
    if (!path.startsWith('/') || path.includes('://')) throw new Error('Expected an API path')
    const write = method !== 'GET'
    let response
    try {
      response = await fetchImpl(`${base}/api${path}`, {
        method,
        credentials: 'omit', redirect: 'error', cache: 'no-store',
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
    } catch {
      throw new ApiError(write
        ? 'No response received. The operation may have completed; review data before retrying.'
        : 'Cannot reach the API. Check the backend and connection.')
    }
    let details
    try { details = await response.json() } catch {
      throw new ApiError('API returned an unreadable response. For writes, review data before retrying.', response.status)
    }
    if (!response.ok) throw new ApiError(details?.error || `API error ${response.status}`, response.status, details)
    return details
  }
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
  }
}
