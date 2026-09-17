import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadCatalogAnalyses } from '../services/views.js'
import { fetchProducts, fetchAnalysis } from '../services/api.js'
import { formatINR, formatPct } from '../lib/format.js'
import { Badge, TrendBadge, Skeleton, LoadingState, ErrorState, EmptyState } from '../components/ui.jsx'

export default function Products() {
  const [products, setProducts] = useState(null)
  const [analyses, setAnalyses] = useState({})
  const [analysisErrors, setAnalysisErrors] = useState({})
  const [analysisDone, setAnalysisDone] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await fetchProducts()
        if (cancelled) return
        setProducts(list)
        const results = await loadCatalogAnalyses(list, fetchAnalysis)
        if (!cancelled) {
          setAnalyses(results.analyses)
          setAnalysisErrors(results.errors)
          setAnalysisDone(true)
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) return <div className="p-8"><ErrorState message={error} onRetry={() => location.reload()} /></div>
  if (!products) return <div className="p-8"><h1 className="text-xl font-semibold">Products</h1><LoadingState /></div>

  const filtered = products.filter((p) => {
    const a = analyses[p.product_id]
    if (filter === 'attention') return a && a.recommendation.status === 'attention'
    if (filter === 'healthy') return a && a.recommendation.status === 'healthy'
    return true
  })

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Products</h1>
          <p className="text-sm text-slate-500 mt-0.5">{products.length} products monitored</p>
        </div>
        <div className="flex gap-2">
          {[
            { key: 'all', label: 'All' },
            { key: 'attention', label: 'Needs attention' },
            { key: 'healthy', label: 'Healthy' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-sm rounded-lg border ${
                filter === f.key
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {Object.keys(analysisErrors).length > 0 && <p role="status" className="text-sm text-amber-700">Some products have unavailable analysis; they are not classified as healthy. Open a product for details.</p>}
      {filtered.length === 0 ? (
        <EmptyState
          title="No products match this filter"
          message="Try All, inspect uploaded data, or reload to retry analysis. Scheduled analysis is not enabled."
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto thin-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="px-5 py-3">Product</th>
                <th className="px-3 py-3">Price</th>
                <th className="px-3 py-3">Rating</th>
                <th className="px-3 py-3">Demand</th>
                <th className="px-3 py-3">14-day fcst</th>
                <th className="px-3 py-3">vs median</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const a = analyses[p.product_id]
                return (
                  <tr key={p.product_id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link to={`/products/${p.product_id}`} className="font-medium text-indigo-700 hover:underline">
                        {p.title}
                      </Link>
                      <div className="text-xs text-slate-400">{p.category} · {p.subcategory}</div>
                    </td>
                    <td className="px-3 py-3">
                      {formatINR(p.price)}
                      {p.discount > 0 && <span className="text-xs text-slate-400 ml-1">−{p.discount}%</span>}
                    </td>
                    <td className="px-3 py-3">★ {p.rating}</td>
                    <td className="px-3 py-3">
                      {a ? <TrendBadge direction={a.demand.trend} changePct={a.demand.change_pct} /> : analysisDone ? <span>Unavailable</span> : <Skeleton className="h-5 w-24" />}
                    </td>
                    <td className="px-3 py-3">
                      {a ? (
                        <Badge tone={a.forecast_summary.delta_vs_recent_pct >= 0 ? 'good' : 'warn'}>
                          {a.forecast_summary.delta_vs_recent_pct >= 0 ? '↑' : '↓'} {formatPct(a.forecast_summary.delta_vs_recent_pct)}
                        </Badge>
                      ) : analysisDone ? <span>Unavailable</span> : <Skeleton className="h-5 w-16" />}
                    </td>
                    <td className="px-3 py-3">
                      {a ? (
                        <Badge tone={a.competitor_metrics.seller_vs_median_pct > 3 ? 'warn' : 'neutral'}>
                          {formatPct(a.competitor_metrics.seller_vs_median_pct)}
                        </Badge>
                      ) : analysisDone ? <span>Unavailable</span> : <Skeleton className="h-5 w-16" />}
                    </td>
                    <td className="px-3 py-3">
                      {a ? (
                        <Badge tone={a.recommendation.status === 'attention' ? 'warn' : 'good'}>
                          {a.recommendation.status === 'attention' ? '⚠ attention' : '✓ healthy'}
                        </Badge>
                      ) : analysisDone ? <span title={analysisErrors[p.product_id]}>Unavailable</span> : <Skeleton className="h-5 w-20" />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
