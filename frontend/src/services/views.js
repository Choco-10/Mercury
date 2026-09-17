/** Read orchestration only: optional failures never invent analysis numbers. */
export async function loadProductView(api, id) {
  const product = await api.fetchProduct(id)
  const names = ['sales', 'competitors', 'forecast', 'analysis']
  const results = await Promise.allSettled([
    api.fetchSalesHistory(id), api.fetchCompetitors(id), api.fetchForecast(id), api.fetchAnalysis(id),
  ])
  const view = { product, sales: [], competitors: [], forecast: null, analysis: null, errors: {} }
  results.forEach((result, index) => {
    const name = names[index]
    if (result.status === 'fulfilled') view[name] = result.value
    else view.errors[name] = result.reason?.message || `${name} unavailable`
  })
  return view
}

export async function loadCatalogAnalyses(products, fetchAnalysis) {
  const results = await Promise.allSettled(products.map((p) => fetchAnalysis(p.product_id)))
  const analyses = {}
  const errors = {}
  results.forEach((result, index) => {
    const id = products[index].product_id
    if (result.status === 'fulfilled') analyses[id] = result.value
    else errors[id] = result.reason?.message || 'Analysis unavailable'
  })
  return { analyses, errors }
}

export function catalogSummary(products, analyses) {
  const available = products.map((p) => analyses[p.product_id]).filter(Boolean)
  return {
    available: available.length,
    attention: available.filter((a) => a.recommendation.status === 'attention').length,
    median: available.length ? Math.round(available.reduce((sum, a) => sum + a.competitor_metrics.competitor_median_price, 0) / available.length) : null,
    revenue: available.length ? available.reduce((sum, a) => sum + a.forecast_summary.total_expected_14d * a.competitor_metrics.seller_price, 0) : null,
    latest: available.reduce((max, a) => a.generated_at > max ? a.generated_at : max, ''),
  }
}
