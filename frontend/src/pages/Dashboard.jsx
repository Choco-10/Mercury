import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadCatalogAnalyses, catalogSummary } from '../services/views.js'
import { fetchProducts, fetchAnalysis } from '../services/api.js'
import { formatINR, formatPct, formatCompactINR } from '../lib/format.js'
import { Card, StatTile, Badge, TrendBadge, Skeleton, LoadingState, ErrorState } from '../components/ui.jsx'

export default function Dashboard() {
  const [products, setProducts] = useState(null)
  const [analyses, setAnalyses] = useState({})
  const [analysisErrors, setAnalysisErrors] = useState({})
  const [analysisDone, setAnalysisDone] = useState(false)
  const [error, setError] = useState(null)

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
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <ErrorState message={error} onRetry={() => location.reload()} />
  if (!products) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <LoadingState label="Loading products and analysis…" />
      </div>
    )
  }
  const analysesList = products.map((p) => analyses[p.product_id]).filter(Boolean)
  const { attention: attentionCount, median: avgCompetitorPrice, revenue: totalRevenue14d, latest: latestTs } = catalogSummary(products, analyses)

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Business overview across your catalog — evidence-based status for each product.
        </p>
      </header>

      {analysisDone && <p className="text-sm text-slate-600">Analysis available for {analysesList.length} of {products.length} products. Summary values cover only available analyses.</p>}
      {Object.keys(analysisErrors).length > 0 && <p role="status" className="text-sm text-amber-700">Some analyses are unavailable. Open the affected product for details or reload to retry.</p>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatTile label="Products monitored" value={products.length} />
        <StatTile
          label="Need attention"
          value={analysesList.length ? attentionCount : analysisDone ? '—' : '…'}
          tone={attentionCount > 0 ? 'warn' : 'good'}
          hint={analysesList.length ? `${attentionCount} of ${analysesList.length} analyzed flagged` : undefined}
        />
        <StatTile label="Avg competitor median price" value={avgCompetitorPrice != null ? formatINR(avgCompetitorPrice) : analysisDone ? '—' : '…'} />
        <StatTile
          label="14-day expected revenue"
          value={analysesList.length ? formatCompactINR(totalRevenue14d) : analysisDone ? '—' : '…'}
          hint="forecast × price (estimate)"
        />
        <StatTile
          label="Latest analysis"
          value={latestTs ? new Date(latestTs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '…'}
          hint={latestTs ? new Date(latestTs).toLocaleDateString('en-IN') : undefined}
        />
      </div>
      {/* Product cards */}
      <Card title="Products" subtitle="Click a product for detailed analytics">
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {products.map((p) => {
            const a = analyses[p.product_id]
            return (
              <Link
                key={p.product_id}
                to={`/products/${p.product_id}`}
                className="block border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{p.title}</div>
                    <div className="text-xs text-slate-500">{p.category} · {p.subcategory}</div>
                  </div>
                  {a && (
                    <Badge tone={a.recommendation.status === 'attention' ? 'warn' : 'good'}>
                      {a.recommendation.status === 'attention' ? '⚠ attention' : '✓ healthy'}
                    </Badge>
                  )}
                </div>
                <div className="mt-3 flex items-baseline gap-3">
                  <span className="text-lg font-semibold">{formatINR(p.price)}</span>
                  <span className="text-xs text-slate-500">★ {p.rating}</span>
                  {p.discount > 0 && <Badge tone="info">{p.discount}% off</Badge>}
                </div>
                <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Demand trend</span>
                    {a ? <TrendBadge direction={a.demand.trend} changePct={a.demand.change_pct} /> : analysisDone ? <span>Unavailable</span> : <Skeleton className="h-4 w-20" />}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>14-day forecast</span>
                    {a ? (
                      <Badge tone={a.forecast_summary.delta_vs_recent_pct >= 0 ? 'good' : 'warn'}>
                        {a.forecast_summary.delta_vs_recent_pct >= 0 ? '↑' : '↓'} {formatPct(a.forecast_summary.delta_vs_recent_pct)}
                      </Badge>
                    ) : analysisDone ? <span>Unavailable</span> : (
                      <Skeleton className="h-4 w-16" />
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Price vs median</span>
                    {a ? (
                      <Badge tone={a.competitor_metrics.seller_vs_median_pct > 3 ? 'warn' : 'neutral'}>
                        {formatPct(a.competitor_metrics.seller_vs_median_pct)}
                      </Badge>
                    ) : analysisDone ? <span>Unavailable</span> : (
                      <Skeleton className="h-4 w-16" />
                    )}
                  </div>
                </div>
                {!a && <div className="mt-3 text-[11px] text-slate-500">{analysisErrors[p.product_id] || 'Loading analysis…'}</div>}
              </Link>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
