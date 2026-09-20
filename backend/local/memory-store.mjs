/** Offline dataset adapter. Mirrors natural-key replacement, not DynamoDB failure semantics. */
import { normalizeStoredDate } from '../src/services/stored-date.js'

export function createMemoryStore(dataset) {
  const products = new Map(dataset.products.map((row) => [row.product_id, structuredClone(row)]))
  const sales = new Map()
  const competitors = new Map()
  const analyses = new Map()
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
  const saleKey = (row) => row.date.slice(0, 10)
  const competitorKey = (row) => `${row.competitor_id}#${row.date.slice(0, 10)}`
  function replace(collection, id, rows, key) {
    if (!collection.has(id)) collection.set(id, new Map())
    for (const row of rows) collection.get(id).set(key(row), structuredClone(row))
  }
  for (const id of products.keys()) {
    replace(sales, id, dataset.sales_history?.[id] || [], saleKey)
    replace(competitors, id, dataset.competitors?.[id] || [], competitorKey)
  }
  function sortedRows(collection, id) {
    return [...(collection.get(id) || new Map()).entries()]
      .sort(([a], [b]) => compare(a, b)).map(([, row]) => row)
  }
  const todayKey = () => new Date().toISOString().slice(0, 10)
  // Snapshots are keyed `<product_id>#<date>`; the `#` delimiter keeps an id
  // like P001 from matching P0010 keys.
  const purgeAnalyses = (id) => {
    for (const key of [...analyses.keys()]) {
      if (key.startsWith(`${id}#`)) analyses.delete(key)
    }
  }
  return {
    getProducts: async () => structuredClone([...products.values()].sort((a, b) => compare(a.product_id, b.product_id))),
    getProduct: async (id) => structuredClone(products.get(id) ?? null),
    putProduct: async (row) => { products.set(row.product_id, structuredClone(row)) },
    // Editing a product invalidates its same-day snapshots so the next read
    // recomputes instead of serving a report built from the old values.
    deleteAnalysis: async (id) => { purgeAnalyses(id) },
    // Cascade: the product row plus every child row keyed by it. Not atomic.
    deleteProduct: async (id) => {
      products.delete(id)
      sales.delete(id)
      competitors.delete(id)
      purgeAnalyses(id)
    },
    getSales: async (id) => structuredClone(sortedRows(sales, id).map((row) => normalizeStoredDate(row, 'date'))),
    putSales: async (id, rows) => { replace(sales, id, rows, saleKey) },
    putCompetitors: async (id, rows) => { replace(competitors, id, rows, competitorKey) },
    getCompetitorsLatest: async (id) => {
      const latest = new Map()
      for (const stored of sortedRows(competitors, id)) {
        const row = normalizeStoredDate(stored, 'date')
        const previous = latest.get(row.competitor_id)
        if (!previous || row.date > previous.date) latest.set(row.competitor_id, row)
      }
      return structuredClone([...latest.values()])
    },
    putAnalysis: async (snapshot) => {
      // Date-keyed: one snapshot per product per day (same-day requests overwrite).
      const day = (typeof snapshot?.generated_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(snapshot.generated_at))
        ? snapshot.generated_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10)
      analyses.set(`${snapshot.product_id}#${day}`, structuredClone(snapshot))
    },
    getAnalysis: async (id) => {
      const cached = analyses.get(`${id}#${todayKey()}`)
      return cached ? structuredClone(cached) : null
    },
  }
}
